import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import generate, main
from app.deps import get_session
from app.flashcards import CardDraft
from app.main import app
from recall_db.database import Base, create_database_engine, create_tables
from recall_db.models import Deck, DeckSource, Flashcard

NOTES = b"Cell biology\n\nThe mitochondria produce ATP through cellular respiration.\nRibosomes build proteins from amino acids."
PDF = b"%PDF-1.7 fake"


@pytest.fixture()
def engine(tmp_path):
    engine = create_database_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def client(engine, monkeypatch):
    def override_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    monkeypatch.setattr(main, "create_tables", lambda: create_tables(engine))
    try:
        with TestClient(app) as client:
            assert client.post("/api/auth/signup", json={
                "email": "student@example.com", "password": "study-password"}).status_code == 201
            yield client
    finally:
        app.dependency_overrides.clear()


def _generate_text_deck(client, monkeypatch):
    async def fake_text(text, *, focus=None):
        return [
            CardDraft(question="What makes ATP?", answer="The mitochondria.",
                      source_quote="The mitochondria produce ATP through cellular respiration."),
            CardDraft(question="What do ribosomes do?", answer="Build proteins from amino acids."),
        ]

    monkeypatch.setattr(generate, "generate_cards_from_text", fake_text)
    response = client.post("/api/flashcards/generate",
                           files={"file": ("bio.txt", NOTES, "text/plain")})
    assert response.status_code == 201
    return response.json()


def test_text_deck_keeps_notes_and_highlights_the_excerpt(client, engine, monkeypatch):
    deck = _generate_text_deck(client, monkeypatch)
    with Session(engine) as session:
        source = session.scalar(select(DeckSource))
        assert source.deck_id == deck["id"] and source.kind == "text" and source.data is None
        assert source.text.startswith("Cell biology")

    first = client.get(f"/api/flashcards/{deck['flashcards'][0]['id']}/source").json()
    assert first["available"] and first["match"] == "excerpt" and first["kind"] == "text"
    assert first["context"]["match"] == "The mitochondria produce ATP through cellular respiration."
    assert first["file_url"] is None

    # No excerpt: fall back to the line sharing the most key terms.
    second = client.get(f"/api/flashcards/{deck['flashcards'][1]['id']}/source").json()
    assert second["match"] == "guess"
    assert second["context"]["match"] == "Ribosomes build proteins from amino acids."


def test_pdf_deck_serves_the_original_file_with_page(client, engine, monkeypatch):
    async def fake_pdf(data, filename, *, focus=None):
        return [CardDraft(question="Q?", answer="A.", source_quote="Quoted line.", source_page=3)]

    monkeypatch.setattr(generate, "generate_cards_from_pdf", fake_pdf)
    deck = client.post("/api/flashcards/generate",
                       files={"file": ("lecture.pdf", PDF, "application/pdf")}).json()
    body = client.get(f"/api/flashcards/{deck['flashcards'][0]['id']}/source").json()
    assert body["kind"] == "pdf" and body["page"] == 3 and body["excerpt"] == "Quoted line."
    assert body["file_url"] == f"/api/decks/{deck['id']}/source/file"

    file = client.get(body["file_url"])
    assert file.status_code == 200 and file.content == PDF
    assert file.headers["content-type"] == "application/pdf"
    assert file.headers["x-content-type-options"] == "nosniff"


def test_sources_are_private_to_the_owner(client, monkeypatch):
    deck = _generate_text_deck(client, monkeypatch)
    card_id = deck["flashcards"][0]["id"]
    client.post("/api/auth/logout")
    client.post("/api/auth/signup", json={"email": "other@example.com", "password": "other-password"})
    assert client.get(f"/api/flashcards/{card_id}/source").status_code == 404
    assert client.get(f"/api/decks/{deck['id']}/source/file").status_code == 404


def test_deck_without_saved_notes_is_unavailable(client, engine):
    me = client.get("/api/auth/me").json()
    with Session(engine) as session:
        deck = Deck(title="Typed by hand", user_id=me["id"])
        deck.flashcards.append(Flashcard(question="Q?", answer="A."))
        session.add(deck)
        session.commit()
        card_id, deck_id = deck.flashcards[0].id, deck.id
    body = client.get(f"/api/flashcards/{card_id}/source").json()
    assert body["available"] is False and body["context"] is None
    assert client.get(f"/api/decks/{deck_id}/source/file").status_code == 404


def test_deleting_a_deck_deletes_its_notes(client, engine, monkeypatch):
    deck = _generate_text_deck(client, monkeypatch)
    with Session(engine) as session:
        session.delete(session.get(Deck, deck["id"]))
        session.commit()
        assert session.scalars(select(DeckSource)).all() == []
