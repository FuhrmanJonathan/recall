"""Study queues and labels use isolated databasess"""

from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import reviews
from app.security import COOKIE_NAME
from recall_db.database import Base, create_database_engine, create_tables
from recall_db.models import CardLabel, CardReviewState, Deck, Flashcard, Review, User
from tests.test_reviews import START, setup  # shared isolated client + authentication fixture


AUTH = {"cookie": f"{COOKIE_NAME}=owner-token"}
OTHER = {"cookie": f"{COOKIE_NAME}=other-token"}


def get(client, query="", headers=AUTH):
    return client.get(f"/api/study/cards{query}", headers=headers)


def put(client, card, labels, headers=AUTH):
    return client.put(f"/api/flashcards/{card}/labels", headers=headers, json={"labels": labels})


def populate(engine, owner, other):
    with Session(engine) as session:
        deck = Deck(title="Second deck", user_id=owner)
        foreign = Deck(title="Private", user_id=other)
        cards = [Flashcard(deck=deck, question=name, answer=name) for name in ["overdue", "boundary", "future"]]
        outsider = Flashcard(deck=foreign, question="Secret", answer="Secret")
        session.add_all([*cards, outsider]); session.flush()
        for card, delta in zip(cards, [-1, 0, 1]):
            session.add(CardReviewState(user_id=owner, flashcard_id=card.id,
                repetitions=1, interval_days=1, ease_factor=2.5,
                last_reviewed_at=START - timedelta(days=2), due_at=START + timedelta(seconds=delta)))
        session.add(CardLabel(flashcard_id=outsider.id, name="private"))
        session.commit()
        return [card.id for card in cards], deck.id, outsider.id, foreign.id


def test_due_boundary_order_and_practice_are_read_only(setup):
    client, engine, (owner, other, new_card) = setup
    (overdue, boundary, future), _, _, _ = populate(engine, owner, other)
    due = get(client).json()
    assert due["total"] == 3
    assert [card["id"] for card in due["cards"]] == [overdue, boundary, new_card]
    assert [card["status"] for card in due["cards"]] == ["due", "due", "new"]
    assert due["cards"][0]["due_at"].endswith("Z")
    for _ in range(2):
        practice = get(client, "?mode=practice").json()
        assert [card["id"] for card in practice["cards"]] == [overdue, boundary, new_card, future]
        assert practice["cards"][-1]["status"] == "upcoming"
    with Session(engine) as session:
        assert session.scalars(select(Review)).all() == []
        assert len(session.scalars(select(CardReviewState)).all()) == 3
        state = session.get(CardReviewState, (owner, future))
        assert (state.repetitions, state.interval_days, state.ease_factor, state.version) == (1, 1, 2.5, 1)
        assert reviews._stored_utc(state.due_at) == START + timedelta(seconds=1)


def test_labels_normalize_persist_filter_and_clear(setup):
    client, engine, (_, _, card) = setup
    response = put(client, card, [" Biology ", "BIOLOGY", "Chapter   3", "Ｅｘａｍ １"])
    assert response.status_code == 200
    assert response.json() == {"labels": ["biology", "chapter 3", "exam 1"]}
    assert client.get("/api/labels", headers=AUTH).json() == ["biology", "chapter 3", "exam 1"]
    assert get(client, "?label=BIOLOGY").json()["cards"][0]["labels"] == response.json()["labels"]
    assert get(client, "?label=missing").json()["total"] == 0
    assert put(client, card, ["new label"]).status_code == 200
    assert get(client, "?label=biology").json()["cards"] == []
    assert put(client, card, []).status_code == 200
    assert client.get("/api/labels", headers=AUTH).json() == []
    with Session(engine) as session:
        assert session.scalars(select(CardLabel)).all() == []


def test_auth_ownership_and_filters(setup):
    client, engine, (owner, other, card) = setup
    cards, deck, outsider, foreign_deck = populate(engine, owner, other)
    assert get(client, headers={}).status_code == 401
    assert client.get("/api/labels").status_code == 401
    assert put(client, card, ["test"], headers={}).status_code == 401
    assert put(client, card, ["test"], headers=OTHER).status_code == 404
    assert put(client, outsider, ["test"]).status_code == 404
    assert put(client, 999999, ["test"]).status_code == 404
    assert client.get("/api/labels", headers=AUTH).json() == []
    assert client.get("/api/labels", headers=OTHER).json() == ["private"]
    assert get(client, f"?deck_id={foreign_deck}").status_code == 404
    assert get(client, "?deck_id=999999").status_code == 404
    assert put(client, cards[0], ["biology"]).status_code == 200
    filtered = get(client, f"?deck_id={deck}&label=biology").json()
    assert [c["id"] for c in filtered["cards"]] == [cards[0]]
    assert get(client, "?label=private").json()["cards"] == []
    assert get(client, "?mode=practice", headers=OTHER).json()["total"] == 1


@pytest.mark.parametrize("labels", [[""], ["  "], ["a,b"], ["a" * 41], ["a"] * 11, [None], [3], "biology"])
def test_invalid_labels_leave_existing_labels_intact(setup, labels):
    client, _, (_, _, card) = setup
    assert put(client, card, ["keep"]).status_code == 200
    assert put(client, card, labels).status_code == 422
    assert client.get("/api/labels", headers=AUTH).json() == ["keep"]


@pytest.mark.parametrize("query", ["?mode=wrong", "?offset=-1", "?limit=101", "?limit=0", "?deck_id=0", "?label=%20"])
def test_invalid_queries(setup, query):
    client, _, _ = setup
    assert get(client, query).status_code == 422


def test_pagination_and_formal_review_removes_due_card(setup):
    client, engine, (owner, other, card) = setup
    populate(engine, owner, other)
    first = get(client, "?limit=2").json()
    second = get(client, "?limit=2&offset=2").json()
    assert first["total"] == second["total"] == 3
    assert len(first["cards"]) == 2 and len(second["cards"]) == 1
    assert {c["id"] for c in first["cards"]}.isdisjoint({c["id"] for c in second["cards"]})
    assert client.post("/api/reviews", headers=AUTH, json={"flashcard_id": card, "rating": "Good"}).status_code == 201
    assert card not in [c["id"] for c in get(client).json()["cards"]]
    assert card in [c["id"] for c in get(client, "?mode=practice").json()["cards"]]


def test_additive_schema_and_cascade(tmp_path):
    engine = create_database_engine(f"sqlite:///{tmp_path / 'old.db'}")
    try:
        Base.metadata.create_all(engine, tables=[t for t in Base.metadata.sorted_tables if t.name != "card_labels"])
        with Session(engine) as session:
            user = User(email="existing@example.com", password_hash="placeholder")
            card = Flashcard(deck=Deck(owner=user, title="Existing"), question="Q", answer="A")
            session.add(card); session.commit(); card_id = card.id
        create_tables(engine); create_tables(engine)
        with Session(engine) as session:
            assert session.get(Flashcard, card_id).question == "Q"
            session.add(CardLabel(flashcard_id=card_id, name="test")); session.commit()
            session.delete(session.get(Flashcard, card_id)); session.commit()
            assert session.scalars(select(CardLabel)).all() == []
    finally:
        engine.dispose()
