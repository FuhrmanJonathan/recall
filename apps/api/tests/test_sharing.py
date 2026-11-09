"""No cross-user access to private decks; copied cards have independent IDs."""
from sqlalchemy.orm import Session
from tests.test_auth import client, engine, signup  # noqa: F401
from recall_db.models import Deck, Flashcard, QuizQuestion


def test_publication_discovery_copy_and_privacy(client, engine):
    assert client.get("/api/public/decks").json() == []
    assert client.post("/api/public/decks/1/copy").status_code == 401
    owner = signup(client).json()["id"]
    with Session(engine) as session:
        deck = Deck(user_id=owner, title="Economics")
        card = Flashcard(
            question="Demand?", answer="Quantity wanted", cloze_blank="Quantity"
        )
        card.quiz_question = QuizQuestion(
            question="Demand is ________ wanted.", answer="quantity", context="Economics"
        )
        deck.flashcards.append(card)
        session.add(deck)
        session.commit()
        deck_id, old_card_id = deck.id, deck.flashcards[0].id
    assert client.get("/api/public/decks").json() == []
    assert client.get(f"/api/public/decks/{deck_id}").status_code == 404
    assert client.put(f"/api/decks/{deck_id}/sharing", json={"is_public": True, "subject":"Econ"}).status_code == 200
    assert len(client.get("/api/public/decks?q=Econ").json()) == 1
    client.post("/api/auth/logout")
    other = signup(client, {"email":"other@example.com","password":"study-password"}).json()["id"]
    assert client.put(f"/api/decks/{deck_id}/sharing", json={"is_public": False}).status_code == 404
    copy = client.post(f"/api/public/decks/{deck_id}/copy")
    assert copy.status_code == 201, copy.text
    new_deck_id = copy.json()["id"]
    with Session(engine) as session:
        new_deck = session.get(Deck,new_deck_id)
        assert new_deck.user_id == other and not new_deck.is_public
        assert new_deck.flashcards[0].id != old_card_id
        assert new_deck.flashcards[0].question == "Demand?"
        assert new_deck.flashcards[0].cloze_blank == "Quantity"
        assert new_deck.flashcards[0].quiz_question.question == "Demand is ________ wanted."
        assert new_deck.flashcards[0].quiz_question.answer == "quantity"
        assert new_deck.flashcards[0].quiz_question.context == "Economics"
        assert new_deck.flashcards[0].quiz_question.version == 1
    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"email":"student@example.com","password":"study-password"})
    assert client.put(f"/api/decks/{deck_id}/sharing",json={"is_public":False}).status_code == 200
    assert client.get(f"/api/public/decks/{deck_id}").status_code == 404
    assert client.get("/api/public/decks").json() == []
