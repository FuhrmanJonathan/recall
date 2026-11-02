from datetime import datetime, timedelta, timezone
import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import goals, main, reviews
from app.deps import get_session
from app.security import COOKIE_NAME, token_digest
from recall_db.database import Base, create_database_engine, create_tables
from recall_db.models import AuthSession, DailyStudyGoal, Deck, Flashcard, Review, User


START = datetime(2026, 11, 2, 18, tzinfo=timezone.utc)


@pytest.fixture()
def setup(tmp_path, monkeypatch):
    engine = create_database_engine(f"sqlite:///{tmp_path / 'goals.db'}")
    create_tables(engine)
    with Session(engine) as session:
        owner = User(email="owner@example.com", password_hash="placeholder")
        other = User(email="other@example.com", password_hash="placeholder")
        card = Flashcard(deck=Deck(title="Study", owner=owner), question="Q?", answer="A")
        session.add_all([card, other])
        session.flush()
        ids = owner.id, other.id, card.id
        for user, token in [(owner, "owner-token"), (other, "other-token")]:
            session.add(AuthSession(user_id=user.id, token_hash=token_digest(token), expires_at=int(time.time()) + 3600))
        session.commit()

    def get_test_session():
        with Session(engine) as session:
            yield session

    main.app.dependency_overrides[get_session] = get_test_session
    monkeypatch.setattr(main, "create_tables", lambda: create_tables(engine))
    monkeypatch.setattr(goals, "_now", lambda: START)
    monkeypatch.setattr(reviews, "_now", lambda: START)
    try:
        with TestClient(main.app) as client:
            client.cookies.set(COOKIE_NAME, "owner-token")
            yield client, engine, ids
    finally:
        main.app.dependency_overrides.clear()
        engine.dispose()


def test_default_and_persisted_goal_are_per_account(setup):
    client, engine, (owner, _, _) = setup
    default = client.get("/api/goals/daily?timezone=America/New_York")
    assert default.status_code == 200
    assert default.headers["cache-control"] == "no-store"
    assert default.json() == {
        "target": 20, "timezone": "America/New_York", "date": "2026-11-02",
        "reviewed": 0, "next_reset_at": "2026-11-03T05:00:00Z",
    }
    with Session(engine) as session:
        assert session.get(DailyStudyGoal, owner) is None
    saved = client.put("/api/goals/daily", json={"target": 30, "timezone": "Asia/Tokyo"})
    assert saved.status_code == 200
    assert saved.json()["date"] == "2026-11-03"
    assert client.get("/api/goals/daily?timezone=UTC").json()["target"] == 30
    assert client.get("/api/goals/daily").json()["timezone"] == "Asia/Tokyo"
    client.cookies.set(COOKIE_NAME, "other-token")
    assert client.get("/api/goals/daily").json()["target"] == 20


def test_only_saved_reviews_count_and_failures_do_not_double_count(setup):
    client, _, (_, _, card) = setup
    assert client.get("/api/study/cards?mode=practice").status_code == 200
    assert client.post("/api/activity", json={"cards_reviewed": 50}).status_code == 200
    assert client.get("/api/goals/daily").json()["reviewed"] == 0
    assert client.post("/api/reviews", json={"flashcard_id": card, "rating": "Good"}).status_code == 201
    assert client.post("/api/reviews", json={"flashcard_id": card, "rating": "Good"}).status_code == 409
    assert client.get("/api/goals/daily").json()["reviewed"] == 1
    assert client.put("/api/goals/daily", json={"target": 1, "timezone": "UTC"}).json()["reviewed"] == 1
    client.cookies.set(COOKIE_NAME, "other-token")
    assert client.get("/api/goals/daily").json()["reviewed"] == 0


@pytest.mark.parametrize("day,start,end", [
    ("2026-03-08T16:00:00+00:00", "2026-03-08T05:00:00+00:00", "2026-03-09T04:00:00+00:00"),
    ("2026-11-01T17:00:00+00:00", "2026-11-01T04:00:00+00:00", "2026-11-02T05:00:00+00:00"),
])
def test_local_midnight_and_dst_boundaries(setup, monkeypatch, day, start, end):
    client, engine, (owner, _, card) = setup
    now, start, end = map(datetime.fromisoformat, (day, start, end))
    monkeypatch.setattr(goals, "_now", lambda: now)
    with Session(engine) as session:
        for when in [start - timedelta(seconds=1), start, now, end]:
            session.add(Review(user_id=owner, flashcard_id=card, rating="Good", created_at=when))
        session.commit()
    body = client.get("/api/goals/daily?timezone=America/New_York").json()
    assert body["reviewed"] == 2
    assert datetime.fromisoformat(body["next_reset_at"]) == end
    monkeypatch.setattr(goals, "_now", lambda: end)
    assert client.get("/api/goals/daily?timezone=America/New_York").json()["reviewed"] == 1


@pytest.mark.parametrize("change", [
    {"target": 0}, {"target": 1001}, {"target": True}, {"target": "20"}, {"target": 2.5},
    {"timezone": "Fake/Zone"}, {"timezone": "../UTC"}, {"user_id": 2},
])
def test_invalid_preferences_do_not_overwrite_saved_goal(setup, change):
    client, _, _ = setup
    assert client.put("/api/goals/daily", json={"target": 10, "timezone": "UTC"}).status_code == 200
    assert client.put("/api/goals/daily", json={"target": 20, "timezone": "UTC", **change}).status_code == 422
    assert client.get("/api/goals/daily").json()["target"] == 10


def test_login_required(setup):
    client, _, _ = setup
    client.cookies.clear()
    assert client.get("/api/goals/daily").status_code == 401
    assert client.put("/api/goals/daily", json={"target": 20, "timezone": "UTC"}).status_code == 401


def test_existing_database_gains_goal_table_without_losing_data(tmp_path):
    engine = create_database_engine(f"sqlite:///{tmp_path / 'existing.db'}")
    try:
        Base.metadata.create_all(engine, tables=[table for table in Base.metadata.sorted_tables if table.name != "daily_study_goals"])
        with Session(engine) as session:
            session.add(User(email="existing@example.com", password_hash="placeholder"))
            session.commit()
        create_tables(engine)
        create_tables(engine)
        with Session(engine) as session:
            assert len(session.scalars(select(User)).all()) == 1
            assert session.scalars(select(DailyStudyGoal)).all() == []
    finally:
        engine.dispose()
