"""Isolated database to test quiz function."""
from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor
import time

import pytest
from openai import OpenAIError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import quiz
from recall_db.models import CardReviewState, Flashcard, Review, StudyActivity
from tests.test_reviews import setup
from tests.test_study import AUTH, OTHER


@pytest.fixture(autouse=True)
def mock_ai(monkeypatch):
    quiz._cache.clear()
    monkeypatch.setenv("OPENAI_API_KEY", "fake-test-key")
    calls = []
    def parse(**kwargs):
        import json
        calls.append(kwargs)
        cards = json.loads(kwargs["input"])
        return SimpleNamespace(status="completed", output_parsed=quiz.Choices(choices=[
            quiz.BlankChoice(source_card_id=c["id"], answer=c["answer"].split()[0]) for c in cards]))
    class FakeClient:
        def __init__(self, **kwargs):
            assert kwargs["max_retries"] == 0
            self.responses = SimpleNamespace(parse=parse)
        def __enter__(self): return self
        def __exit__(self, *args): pass
    monkeypatch.setattr(quiz, "OpenAI", FakeClient)
    yield calls
    quiz._cache.clear()


def post(client, ids, headers=AUTH, path="cloze"):
    return client.post(f"/api/quiz/{path}", headers=headers, json={"card_ids": ids})


def test_cached_generation_read_only(setup, mock_ai):
    client, engine, (_, _, card) = setup
    source = post(client, [card], path="sources")
    assert source.status_code == 200 and not mock_ai
    first = post(client, [card, card])
    assert first.status_code == 200
    assert first.json()["provider"] == "openai"
    assert first.json()["fingerprint"] == source.json()["fingerprint"]
    assert first.headers["cache-control"] == "no-store"
    assert first.json()["exercises"][0]["answer"] == "Two"
    assert post(client, [card]).json() == first.json()
    assert len(mock_ai) == 1
    assert mock_ai[0]["store"] is False and mock_ai[0]["max_output_tokens"] == 1200
    with Session(engine) as s:
        assert s.get(Flashcard, card).answer == "Two"
        for model in (Review, CardReviewState, StudyActivity):
            assert s.scalars(select(model)).all() == []
        s.get(Flashcard, card).answer = "Three"
        s.commit()
    assert post(client, [card]).json()["exercises"][0]["answer"] == "Three"
    assert len(mock_ai) == 2


@pytest.mark.parametrize("path", ["sources", "cloze"])
def test_access(setup, mock_ai, path):
    client, _, (_, _, card) = setup
    assert post(client, [card], {}, path).status_code == 401
    assert post(client, [card], OTHER, path).status_code == 404
    assert post(client, [card, 999999], path=path).status_code == 404
    assert not mock_ai


@pytest.mark.parametrize("ids", [[], [1]*101, [0], [-1], [True], [1.5], ["1"], None])
def test_invalid_requests(setup, ids, mock_ai):
    client, _, _ = setup
    assert post(client, ids).status_code == 422
    assert not mock_ai


@pytest.mark.parametrize("answer", ["...", "x"*12001])
def test_bad_source(setup, answer, mock_ai):
    client, engine, (_, _, card) = setup
    with Session(engine) as s:
        s.get(Flashcard, card).answer = answer
        s.commit()
    assert post(client, [card]).status_code == 422
    assert not mock_ai


def test_missing_key(setup, monkeypatch, mock_ai):
    client, _, (_, _, card) = setup
    monkeypatch.delenv("OPENAI_API_KEY")
    assert post(client, [card]).status_code == 503
    assert not mock_ai


@pytest.mark.parametrize("kind", ["refusal", "incomplete", "empty", "foreign", "duplicate", "invented", "error"])
def test_bad_ai_output_safe_error(setup, monkeypatch, kind):
    client, _, (_, _, card) = setup
    def parse(**kwargs):
        if kind == "error": raise OpenAIError("private upstream details")
        choice = quiz.BlankChoice(source_card_id=999 if kind == "foreign" else card,
                                      answer="invented" if kind == "invented" else "Two")
        choices = [] if kind == "empty" else [choice, choice] if kind == "duplicate" else [choice]
        return SimpleNamespace(status="incomplete" if kind == "incomplete" else "completed",
            output_parsed=None if kind == "refusal" else quiz.Choices(choices=choices))
    class Client:
        def __init__(self, **kwargs): self.responses = SimpleNamespace(parse=parse)
        def __enter__(self): return self
        def __exit__(self, *args): pass
    monkeypatch.setattr(quiz, "OpenAI", Client)
    result = post(client, [card])
    assert result.status_code == 502
    assert "private" not in result.text and "fake-test-key" not in result.text
    assert not quiz._cache


def test_concurrent_requests_only_generate_once(setup, monkeypatch):
    client, _, (_, _, card) = setup
    original = quiz.generate_exercises
    calls = []
    def slow(cards):
        calls.append(1); time.sleep(.1)
        return original(cards)
    monkeypatch.setattr(quiz, "generate_exercises", slow)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: post(client, [card]), range(2)))
    assert all(r.status_code == 200 for r in results)
    assert len(calls) == 1


@pytest.mark.parametrize("count", [6, 20, 21, 50, 51, 100])
def test_selected_count_confirmation_and_single_request(setup, mock_ai, count):
    client, engine, (_, _, card_id) = setup
    with Session(engine) as session:
        deck_id = session.get(Flashcard, card_id).deck_id
        cards = [Flashcard(deck_id=deck_id, question=f"Q{i}", answer=f"Answer {i}") for i in range(count)]
        session.add_all(cards); session.commit()
        ids = [c.id for c in cards]
    assert post(client, ids, path="sources").status_code == 200
    assert not mock_ai
    result = post(client, ids)
    if count > 20:
        assert result.status_code == 422 and not mock_ai
        result = client.post("/api/quiz/cloze", headers=AUTH, json={"card_ids": ids, "confirmed_large": True})
    assert result.status_code == 200
    assert [e["source_card_id"] for e in result.json()["exercises"]] == ids
    assert len(mock_ai) == 1
    assert mock_ai[0]["max_output_tokens"] == max(1200, 160 * count)
