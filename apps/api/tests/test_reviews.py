from datetime import datetime, timedelta, timezone
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app import main, reviews
from app.deps import get_session
from app.security import COOKIE_NAME, token_digest
from recall_db.database import Base, create_database_engine, create_tables
from recall_db.models import AuthSession, CardReviewState, Deck, Flashcard, Review, StudyActivity, User


START = datetime(2026, 10, 19, 12, tzinfo=timezone.utc)


@pytest.fixture()
def setup(tmp_path, monkeypatch):
    engine = create_database_engine(f"sqlite:///{tmp_path / 'reviews.db'}")
    create_tables(engine)
    with Session(engine) as session:
        owner = User(email="owner@example.com", password_hash="placeholder")
        other = User(email="other@example.com", password_hash="placeholder")
        deck = Deck(title="Study", owner=owner)
        card = Flashcard(deck=deck, question="One plus one?", answer="Two")
        session.add_all([card, other])
        session.flush()
        ids = owner.id, other.id, card.id
        for user, token in [(owner, "owner-token"), (other, "other-token")]:
            session.add(AuthSession(
                user_id=user.id, token_hash=token_digest(token),
                expires_at=int(time.time()) + 3600,
            ))
        session.commit()

    def get_test_session():
        with Session(engine) as session:
            yield session

    main.app.dependency_overrides[get_session] = get_test_session
    monkeypatch.setattr(main, "create_tables", lambda: create_tables(engine))
    monkeypatch.setattr(reviews, "_now", lambda: START)
    try:
        with TestClient(main.app) as client:
            yield client, engine, ids
    finally:
        main.app.dependency_overrides.clear()
        engine.dispose()


def post(client, card_id, rating="Good", token="owner-token", **extra):
    headers = {"cookie": f"{COOKIE_NAME}={token}"} if token else {}
    return client.post("/api/reviews", headers=headers, json={
        "flashcard_id": card_id, "rating": rating, **extra,
    })


def test_full_sequence_reads_persisted_state_and_records_history(setup, monkeypatch):
    client, engine, (owner, _, card_id) = setup
    now = START
    sequence = [
        ("Good", 1, 1, 2.5), ("Hard", 2, 6, 2.36),
        ("Good", 3, 15, 2.36), ("Good", 4, 36, 2.36),
        ("Again", 0, 1, 2.04), ("Good", 1, 1, 2.04),
        ("Good", 2, 6, 2.04), ("Easy", 3, 13, 2.14),
    ]
    for index, (rating, reps, interval, ease) in enumerate(sequence, 1):
        monkeypatch.setattr(reviews, "_now", lambda: now)
        response = post(client, card_id, rating)
        assert response.status_code == 201, response.text
        body = response.json()
        assert (body["repetitions"], body["interval_days"], body["ease_factor"]) == (reps, interval, ease)
        assert body["quality"] == {"Again": 2, "Hard": 3, "Good": 4, "Easy": 5}[rating]
        due = now + timedelta(days=interval)
        assert datetime.fromisoformat(body["due_at"]) == due
        assert datetime.fromisoformat(body["last_reviewed_at"]) == now
        # Every request uses a new session; SQLite has stripped stored tzinfo.
        with Session(engine) as session:
            state = session.get(CardReviewState, (owner, card_id))
            assert (state.repetitions, state.interval_days, state.ease_factor) == (reps, interval, ease)
            history = session.scalars(select(Review).order_by(Review.id)).all()
            assert len(history) == index
            activity = session.scalar(select(StudyActivity).where(
                StudyActivity.user_id == owner,
                StudyActivity.study_date == now.date(),
            ))
            assert activity is not None
            # One daily total for each UTC date touched by the review sequence.
            assert activity.cards_reviewed == 1
            assert history[-1].rating == rating
            assert history[-1].id == body["review_id"]
            assert reviews._stored_utc(history[-1].created_at) == now
        now = due


@pytest.mark.parametrize("token,card_id,status", [
    (None, None, 401), ("invalid", None, 401),
    ("other-token", None, 404), ("owner-token", 99999, 404),
])
def test_auth_and_ownership(setup, token, card_id, status):
    client, engine, (_, _, actual_card) = setup
    assert post(client, card_id or actual_card, token=token).status_code == status
    with Session(engine) as session:
        assert session.scalars(select(Review)).all() == []
        assert session.scalars(select(CardReviewState)).all() == []


@pytest.mark.parametrize("rating", ["skip", "", None, 4, True])
def test_invalid_ratings_do_not_write(setup, rating):
    client, engine, (_, _, card_id) = setup
    assert post(client, card_id, rating).status_code == 422
    with Session(engine) as session:
        assert session.scalars(select(Review)).all() == []
        assert session.scalars(select(CardReviewState)).all() == []


@pytest.mark.parametrize("card_id", [0, -1, True, "1", 1.5])
def test_invalid_ids(setup, card_id):
    client, _, _ = setup
    assert post(client, card_id).status_code == 422


def test_client_cannot_choose_user_or_review_time(setup):
    client, _, (_, other, card_id) = setup
    assert post(client, card_id, user_id=other).status_code == 422
    assert post(client, card_id, reviewed_at=START.isoformat()).status_code == 422


def test_duplicate_and_early_reviews_do_not_advance(setup, monkeypatch):
    client, engine, (owner, _, card_id) = setup
    assert post(client, card_id, "good").status_code == 201
    assert post(client, card_id).status_code == 409
    monkeypatch.setattr(reviews, "_now", lambda: START + timedelta(hours=23))
    assert post(client, card_id).status_code == 409
    with Session(engine) as session:
        assert session.get(CardReviewState, (owner, card_id)).repetitions == 1
        assert len(session.scalars(select(Review)).all()) == 1
        assert session.scalar(select(StudyActivity).where(
            StudyActivity.user_id == owner,
        )).cards_reviewed == 1


def test_overdue_review_starts_at_actual_time(setup, monkeypatch):
    client, _, (_, _, card_id) = setup
    assert post(client, card_id).status_code == 201
    later = START + timedelta(days=10)
    monkeypatch.setattr(reviews, "_now", lambda: later)
    result = post(client, card_id).json()
    assert datetime.fromisoformat(result["due_at"]) == later + timedelta(days=6)


def test_history_failure_rolls_back_state(setup, monkeypatch):
    client, engine, (owner, _, card_id) = setup
    assert post(client, card_id).status_code == 201
    monkeypatch.setattr(reviews, "_now", lambda: START + timedelta(days=1))

    def reject_history(*args):
        raise IntegrityError("test failure", {}, Exception("history insert failed"))

    event.listen(Review, "before_insert", reject_history)
    try:
        assert post(client, card_id).status_code == 409
    finally:
        event.remove(Review, "before_insert", reject_history)
    with Session(engine) as session:
        assert session.get(CardReviewState, (owner, card_id)).repetitions == 1
        assert len(session.scalars(select(Review)).all()) == 1


def test_state_survives_reopening_database(setup):
    client, engine, (owner, _, card_id) = setup
    assert post(client, card_id).status_code == 201
    reopened = create_database_engine(str(engine.url))
    try:
        with Session(reopened) as session:
            state = session.get(CardReviewState, (owner, card_id))
            assert state.interval_days == 1
            assert reviews._stored_utc(state.due_at) == START + timedelta(days=1)
    finally:
        reopened.dispose()


def test_stale_state_cannot_overwrite_newer_review(setup):
    client, engine, (owner, _, card_id) = setup
    assert post(client, card_id).status_code == 201
    with Session(engine) as first, Session(engine) as second:
        state_a = first.get(CardReviewState, (owner, card_id))
        state_b = second.get(CardReviewState, (owner, card_id))
        state_a.ease_factor = 2.6
        first.commit()
        state_b.ease_factor = 2.36
        with pytest.raises(StaleDataError):
            second.commit()
        second.rollback()


def test_deleting_card_removes_state_and_history(setup):
    client, engine, (_, _, card_id) = setup
    assert post(client, card_id).status_code == 201
    with Session(engine) as session:
        session.delete(session.get(Flashcard, card_id))
        session.commit()
        assert session.scalars(select(CardReviewState)).all() == []
        assert session.scalars(select(Review)).all() == []


def test_create_tables_adds_state_table_without_losing_existing_data(tmp_path):
    engine = create_database_engine(f"sqlite:///{tmp_path / 'existing.db'}")
    try:
        # Simulate the schema before this feature, including existing history.
        Base.metadata.create_all(engine, tables=[
            table for table in Base.metadata.sorted_tables
            if table.name != "card_review_states"
        ])
        with Session(engine) as session:
            user = User(email="existing@example.com", password_hash="placeholder")
            card = Flashcard(
                deck=Deck(title="Existing deck", owner=user), question="Q", answer="A"
            )
            session.add(card)
            session.flush()
            session.add(Review(user_id=user.id, flashcard_id=card.id, rating="Good"))
            session.commit()
        create_tables(engine)
        create_tables(engine)
        with Session(engine) as session:
            assert len(session.scalars(select(User)).all()) == 1
            assert len(session.scalars(select(Flashcard)).all()) == 1
            assert len(session.scalars(select(Review)).all()) == 1
            assert session.scalars(select(CardReviewState)).all() == []
    finally:
        engine.dispose()
