"""Saved quiz questions, immutable history, ownership and missed-question practice."""
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy import select, event
from sqlalchemy.orm import Session

from app import flashcards
from recall_db.database import Base, create_database_engine, create_tables
from recall_db.models import CardReviewState, Deck, Flashcard, QuizQuestion, QuizRun, Review, StudyActivity, User
from tests.test_reviews import setup
from tests.test_study import AUTH, OTHER


@pytest.fixture(autouse=True)
def no_ai(monkeypatch):
    def forbidden():
        pytest.fail("Quiz and manual edits must not request AI")
    monkeypatch.setattr(flashcards, "get_client", forbidden)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)


def add_card(engine, base, answer="Cell division.", blank="division", question="What happens?"):
    with Session(engine) as s:
        card = Flashcard(deck_id=s.get(Flashcard, base).deck_id, question=question, answer=answer, cloze_blank=blank)
        s.add(card); s.commit()
        return card.id


def start(client, ids=None, **kwargs):
    body = {"request_id": str(uuid4()), **({"card_ids": ids} if ids is not None else {}), **kwargs}
    return client.post("/api/quiz/runs", headers=AUTH, json=body)


def finish(client, run, texts, marks=None):
    return client.put(f'/api/quiz/runs/{run["id"]}/complete', headers=AUTH, json={"attempts": [
        {"text": text, "revealed": True, "markedCorrect": bool(marks and marks[i])} for i, text in enumerate(texts)]})


def test_saved_blank_without_key_and_read_only_preview(setup):
    client, engine, (_, _, base) = setup
    card = add_card(engine, base, "ATP is made. ATP stores energy.", "ATP")
    first = client.post('/api/quiz/cloze', headers=AUTH, json={"card_ids": [card, card]})
    assert first.status_code == 200 and first.json()["provider"] == "stored"
    assert first.headers["cache-control"] == "no-store"
    assert first.json()["exercises"] == [{"source_card_id": card, "context": "What happens?", "before": "", "answer": "ATP", "after": " is made. ________ stores energy."}]
    with Session(engine) as s:
        for model in (Review, CardReviewState, StudyActivity, QuizRun):
            assert s.scalars(select(model)).all() == []


@pytest.mark.parametrize("path", ["sources", "cloze", "runs"])
def test_missing_or_stale_blank_never_falls_back_to_ai(setup, path):
    client, engine, (_, _, base) = setup
    for blank in [None, "not present", "..."]:
        card = add_card(engine, base, blank=blank)
        body = {"card_ids": [card]}
        if path == "runs": body["request_id"] = str(uuid4())
        result = client.post(f'/api/quiz/{path}', headers=AUTH, json=body)
        assert result.status_code == 422
        assert str(card) in result.json()["detail"]


@pytest.mark.parametrize("ids", [[], [1]*101, [0], [-1], [True], [1.5], ["1"], None])
def test_invalid_card_selection(setup, ids):
    client, _, _ = setup
    assert start(client, ids).status_code == 422


@pytest.mark.parametrize("count", [1, 20, 21, 100])
def test_fixed_questions_at_selection_limit(setup, count):
    client, engine, (_, _, base) = setup
    ids = [add_card(engine, base) for _ in range(count)]
    result = start(client, ids)
    assert result.status_code == 201
    assert [q['source_card_id'] for q in result.json()['exercises']] == ids


def test_text_limit_still_applies(setup):
    client, engine, (_, _, base) = setup
    card = add_card(engine, base, answer='x'*12001, blank='x')
    assert start(client, [card]).status_code == 422


def test_history_and_retry_preserve_scores_and_source_snapshots(setup):
    client, engine, (owner, _, base) = setup
    ids = [add_card(engine, base, answer=a, blank=a) for a in ('α', 'Two', 'Three', 'Four')]
    run = start(client, ids).json()
    assert client.get('/api/quiz/history', headers=AUTH).json() == {"items": [], "total": 0}
    saved = finish(client, run, ['alpha', 'wrong', '', 'IV'], [False, False, False, True])
    assert saved.status_code == 200
    body = saved.json()
    assert body['summary'] == {'correct': 2, 'incorrect': 1, 'unanswered': 1, 'accuracy': 50}
    assert body['attempts'][3]['markedCorrect']
    # Identical completion is safe to retry; a different answer cannot rewrite history.
    assert finish(client, run, ['alpha', 'wrong', '', 'IV'], [False, False, False, True]).json() == body
    assert finish(client, run, ['alpha', 'Two', 'Three', 'Four']).status_code == 409
    with Session(engine) as s:
        s.get(Flashcard, ids[1]).answer = 'Changed answer'
        s.delete(s.get(Flashcard, ids[2])); s.commit()
    retry = start(client, parent_id=run['id'], mode='missed').json()
    assert retry['parent_id'] == run['id'] and retry['question_count'] == 2
    assert [q['answer'] for q in retry['exercises']] == ['Two', 'Three']
    result = finish(client, retry, ['Two', 'Three']).json()
    assert result['summary']['accuracy'] == 100
    assert start(client, parent_id=retry['id'], mode='missed').status_code == 409
    history = client.get('/api/quiz/history', headers=AUTH).json()
    assert history['total'] == 2
    assert history['items'][0]['id'] == retry['id']
    assert 'exercises' not in history['items'][0]
    assert client.get(f'/api/quiz/runs/{run["id"]}', headers=AUTH).json() == body
    repeated = start(client, parent_id=run['id'], mode='repeat').json()
    assert repeated['exercises'] == run['exercises']
    with Session(engine) as s:
        for model in (Review, CardReviewState, StudyActivity):
            assert s.scalars(select(model)).all() == []


def test_access_is_checked_for_every_route(setup):
    client, engine, (_, _, base) = setup
    card = add_card(engine, base)
    run = start(client, [card]).json()
    for headers, expected in [({}, 401), (OTHER, 404)]:
        assert client.get(f'/api/quiz/runs/{run["id"]}', headers=headers).status_code == expected
        assert client.put(f'/api/quiz/runs/{run["id"]}/complete', headers=headers, json={"attempts": [{"text": "division", "revealed": True}]}).status_code == expected
        for body in [{"request_id": str(uuid4()), "card_ids": [card]}, {"request_id": str(uuid4()), "parent_id": run['id'], "mode": "missed"}, {"request_id": run['id'], "card_ids": [card]}]:
            assert client.post('/api/quiz/runs', headers=headers, json=body).status_code == expected
        for path in ['cloze', 'sources']:
            assert client.post(f'/api/quiz/{path}', headers=headers, json={'card_ids': [card]}).status_code == expected
    assert client.get('/api/quiz/history').status_code == 401
    assert client.get('/api/quiz/history', headers=OTHER).json()['total'] == 0
    assert start(client, [card, 999999]).status_code == 404


def test_request_replay_and_concurrent_completion(setup):
    client, engine, (_, _, base) = setup
    card = add_card(engine, base)
    request_id = str(uuid4())
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: start(client, [card], request_id=request_id), range(2)))
    assert all(r.status_code in (200, 201) for r in responses)
    assert responses[0].json() == responses[1].json()
    run = responses[0].json()
    assert start(client, [card, base], request_id=request_id).status_code == 409
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda text: finish(client, run, [text]), ['wrong', 'division']))
    assert sorted(r.status_code for r in responses) == [200, 409]
    with Session(engine) as s:
        assert len(s.scalars(select(QuizRun)).all()) == 1


def test_invalid_completion_and_failed_save_can_retry(setup):
    client, engine, (_, _, base) = setup
    card = add_card(engine, base)
    run = start(client, [card]).json()
    assert start(client, parent_id=run['id'], mode='missed').status_code == 409
    url = f'/api/quiz/runs/{run["id"]}/complete'
    for attempts in [[], [{'text': 'x', 'revealed': 'yes'}], [{'text': 'x'*2001, 'revealed': True}], [{'text': 'x', 'revealed': True, 'result': 'correct'}], [{'text': 'x', 'revealed': True}]*2]:
        assert client.put(url, headers=AUTH, json={'attempts': attempts}).status_code == 422
    def fail_commit(session):
        raise RuntimeError('Simulated database failure')
    event.listen(Session, 'before_commit', fail_commit)
    try:
        with pytest.raises(RuntimeError, match='Simulated'):
            finish(client, run, ['division'])
    finally:
        event.remove(Session, 'before_commit', fail_commit)
    assert client.get('/api/quiz/history', headers=AUTH).json()['total'] == 0
    assert finish(client, run, ['division']).status_code == 200


def test_quiz_editor_is_independent_and_preserves_history(setup):
    client, engine, (_, _, base) = setup
    card = add_card(engine, base)
    old = start(client, [card]).json()
    finish(client, old, ['division'])
    url = f'/api/quiz/cards/{card}/question'
    initial = client.get(url, headers=AUTH).json()
    assert '________' in initial['question'] and initial['answer'] == 'division'
    payload = {'question': 'The capital of France is ________.', 'answer': 'Paris', 'version': initial['version']}
    saved = client.put(url, headers=AUTH, json=payload)
    assert saved.status_code == 200 and saved.json()['version'] == 1
    with Session(engine) as s:
        original = s.get(Flashcard, card)
        assert original.question == 'What happens?' and original.answer == 'Cell division.'
        deck_id = original.deck_id
    new = start(client, [card]).json()['exercises'][0]
    assert new['context'] == '' and new['answer'] == 'Paris' and new['before'] == 'The capital of France is '
    assert client.get(f'/api/quiz/runs/{old["id"]}', headers=AUTH).json()['exercises'][0]['answer'] == 'division'
    # Both card-edit APIs leave the saved quiz intact.
    assert client.patch(f'/api/flashcards/{card}', headers=AUTH, json={'question':'New question', 'answer':'New answer'}).status_code == 200
    deck = client.get(f'/api/decks/{deck_id}', headers=AUTH).json()
    payload = {key: deck[key] for key in ['title', 'version', 'flashcards']}
    for item in payload['flashcards']:
        if item['id'] == card:
            item['answer'] = 'Another answer'
    assert client.put(f'/api/decks/{deck_id}', headers=AUTH, json=payload).status_code == 200
    assert client.get(url, headers=AUTH).json()['answer'] == 'Paris'
    assert start(client, [card]).json()['exercises'][0]['answer'] == 'Paris'


def test_editing_legacy_card_preserves_its_quiz_first(setup):
    client, engine, (_, _, base) = setup
    card = add_card(engine, base)
    before = start(client, [card]).json()['exercises']
    assert client.patch(f'/api/flashcards/{card}', headers=AUTH, json={'answer':'Completely different'}).status_code == 200
    assert start(client, [card]).json()['exercises'] == before


def test_quiz_editor_validates_and_prevents_stale_overwrite(setup):
    client, engine, (_, _, base) = setup
    card = add_card(engine, base)
    url = f'/api/quiz/cards/{card}/question'
    good = {'question':'A ________ question.', 'answer':'valid', 'version':0}
    for changes in [{'question':'No blank'}, {'question':'________'}, {'answer':'   '}, {'answer':'________'},
                    {'question':'x'*5001}, {'answer':'x'*201}, {'version':True}]:
        assert client.put(url, headers=AUTH, json={**good, **changes}).status_code == 422
    assert client.get(url, headers=OTHER).status_code == 404
    assert client.put(url, headers=OTHER, json=good).status_code == 404
    assert client.get(url).status_code == 401
    assert client.put(url, headers=AUTH, json=good).status_code == 200
    assert client.put(url, headers=AUTH, json={**good, 'answer':'stale'}).status_code == 409
    assert client.put(url, headers=AUTH, json={**good, 'version':1, 'answer':'updated'}).status_code == 200
    assert client.put(url, headers=AUTH, json={**good, 'version':1, 'answer':'stale again'}).status_code == 409
    assert client.get(url, headers=AUTH).json()['answer'] == 'updated'


def test_generated_cards_save_independent_quiz_without_extra_ai(setup):
    from app.generate import _save_deck
    from app.flashcards import CardDraft
    client, engine, (owner, _, _) = setup
    with Session(engine) as s:
        deck = _save_deck(s, s.get(User, owner), 'Generated', [CardDraft(question='What happens?', answer='Cell division.', cloze_blank='division')])
        card_id = deck.flashcards[0].id
        assert deck.flashcards[0].quiz_question.answer == 'division'
    editor = client.get(f'/api/quiz/cards/{card_id}/question', headers=AUTH).json()
    assert editor['version'] == 1
    assert editor['question'] == 'What happens?\nCell ________.'


def test_history_pagination(setup):
    client, engine, (_, _, base) = setup
    card = add_card(engine, base)
    for _ in range(3):
        run = start(client, [card]).json()
        finish(client, run, ['division'])
    first = client.get('/api/quiz/history?limit=2', headers=AUTH).json()
    second = client.get('/api/quiz/history?limit=2&offset=2', headers=AUTH).json()
    assert first['total'] == second['total'] == 3
    assert len(first['items']) == 2 and len(second['items']) == 1
    assert len({r['id'] for r in first['items'] + second['items']}) == 3


def test_existing_database_adds_quiz_table_without_losing_data(tmp_path):
    engine = create_database_engine(f'sqlite:///{tmp_path / "old.db"}')
    try:
        Base.metadata.create_all(engine, tables=[t for t in Base.metadata.sorted_tables if t.name not in ('quiz_runs', 'quiz_questions')])
        with Session(engine) as s:
            s.add(User(email='existing@example.com', password_hash='placeholder')); s.commit()
        create_tables(engine); create_tables(engine)
        with Session(engine) as s:
            assert len(s.scalars(select(User)).all()) == 1
            assert s.scalars(select(QuizRun)).all() == []
            assert s.scalars(select(QuizQuestion)).all() == []
    finally:
        engine.dispose()


def test_study_exposes_blank_availability_and_manual_updates(setup):
    client, engine, (_, _, base) = setup
    card = add_card(engine, base)
    response = client.get('/api/study/cards?mode=practice', headers=AUTH).json()
    ready = {c['id']: c['quiz_ready'] for c in response['cards']}
    assert ready[base] is False and ready[card] is True
    assert client.put(f'/api/quiz/cards/{base}/question', headers=AUTH, json={'question':'One plus one is ________.', 'answer':'Two', 'version':0}).status_code == 200
    updated = client.get('/api/study/cards?mode=practice', headers=AUTH).json()
    assert next(c for c in updated['cards'] if c['id'] == base)['quiz_ready'] is True
    assert start(client, [base]).status_code == 201


def test_history_timestamps_preserve_the_actual_instant():
    from datetime import datetime, timedelta, timezone
    from app.quiz import utc_text
    assert utc_text(None) is None
    assert utc_text(datetime(2026, 11, 9, 12)) == "2026-11-09T12:00:00+00:00"
    assert utc_text(datetime(2026, 11, 9, 7, tzinfo=timezone(timedelta(hours=-5)))) == "2026-11-09T12:00:00+00:00"
