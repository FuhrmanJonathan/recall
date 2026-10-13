import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import flashcards, generate
from app.deps import get_session
from app.documents import SourceKind, detect_source_kind
from app.flashcards import CardDraft, CardSet
from app.main import app
from app.ocr import OCRUnavailableError
from recall_db.database import Base, create_database_engine
from recall_db.models import Deck, Flashcard, User

CARDS = [
    CardDraft(question="What is mitosis?", answer="Cell division."),
    CardDraft(question="What is the powerhouse of the cell?", answer="The mitochondria."),
]


@pytest.fixture()
def engine(tmp_path):
    engine = create_database_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def client(engine):
    def override_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    yield TestClient(app)  # not used as a context manager, so the real DB isn't created
    app.dependency_overrides.clear()


def test_detect_source_kind():
    assert detect_source_kind("Notes.PDF") is SourceKind.PDF
    assert detect_source_kind("page.jpeg") is SourceKind.IMAGE
    assert detect_source_kind("a.docx") is SourceKind.DOCX
    assert detect_source_kind("a.exe") is None
    assert detect_source_kind(None) is None


def test_text_upload_saves_deck(client, engine, monkeypatch):
    seen = {}

    async def fake_text(text, *, from_ocr=False):
        seen["text"], seen["from_ocr"] = text, from_ocr
        return CARDS

    monkeypatch.setattr(generate, "generate_cards_from_text", fake_text)
    response = client.post(
        "/api/flashcards/generate",
        files={"file": ("bio.txt", b"  Mitosis  \r\n\r\n\r\n Cell division ", "text/plain")},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "bio"
    assert body["source"] == "text"
    assert [c["question"] for c in body["flashcards"]] == [c.question for c in CARDS]
    assert seen == {"text": "Mitosis\n\nCell division", "from_ocr": False}

    with Session(engine) as session:
        deck = session.scalar(select(Deck))
        assert len(deck.flashcards) == 2
        assert deck.owner.email == "1234@recall.local"

    assert client.get(f"/api/decks/{body['id']}").json()["title"] == "bio"
    assert client.get("/api/decks/999").status_code == 404


def test_pdf_goes_straight_to_openai(client, monkeypatch):
    seen = {}

    async def fake_pdf(data, filename):
        seen["filename"] = filename
        return CARDS

    async def fail_text(*args, **kwargs):
        raise AssertionError("PDFs must not go through the text path")

    def fail_ocr(_):
        raise AssertionError("PDFs must not go through OCR")

    monkeypatch.setattr(generate, "generate_cards_from_pdf", fake_pdf)
    monkeypatch.setattr(generate, "generate_cards_from_text", fail_text)
    monkeypatch.setattr(generate, "extract_text_from_image", fail_ocr)

    response = client.post(
        "/api/flashcards/generate",
        data={"title": "Week 3"},
        files={"file": ("lecture.pdf", b"%PDF-1.7 fake", "application/pdf")},
    )
    assert response.status_code == 201
    assert response.json()["title"] == "Week 3"
    assert seen["filename"] == "lecture.pdf"


def test_fake_pdf_is_rejected(client):
    response = client.post(
        "/api/flashcards/generate", files={"file": ("x.pdf", b"not a pdf", "application/pdf")}
    )
    assert response.status_code == 400


def test_image_goes_through_ocr_then_openai(client, monkeypatch):
    seen = {}

    monkeypatch.setattr(generate, "extract_text_from_image", lambda data: "  Krebs cycle\n\n\n\nATP ")

    async def fake_text(text, *, from_ocr=False):
        seen["text"], seen["from_ocr"] = text, from_ocr
        return CARDS

    monkeypatch.setattr(generate, "generate_cards_from_text", fake_text)
    response = client.post(
        "/api/flashcards/generate", files={"file": ("page.png", b"\x89PNG", "image/png")}
    )
    assert response.status_code == 201
    assert response.json()["source"] == "image"
    assert seen == {"text": "Krebs cycle\n\nATP", "from_ocr": True}


def test_blank_ocr_result_is_422(client, monkeypatch):
    monkeypatch.setattr(generate, "extract_text_from_image", lambda data: "  \n ")
    response = client.post(
        "/api/flashcards/generate", files={"file": ("page.jpg", b"x", "image/jpeg")}
    )
    assert response.status_code == 422


def test_missing_ocr_install_is_503(client, monkeypatch):
    def unavailable(_):
        raise OCRUnavailableError("OCR is not installed.")

    monkeypatch.setattr(generate, "extract_text_from_image", unavailable)
    response = client.post(
        "/api/flashcards/generate", files={"file": ("page.jpg", b"x", "image/jpeg")}
    )
    assert response.status_code == 503


def test_unsupported_type_is_415(client):
    response = client.post("/api/flashcards/generate", files={"file": ("a.exe", b"x")})
    assert response.status_code == 415


def test_rejected_upload_saves_nothing(client, engine):
    client.post("/api/flashcards/generate", files={"file": ("a.exe", b"x")})
    with Session(engine) as session:
        assert session.scalars(select(Flashcard)).all() == []
        assert session.scalars(select(Deck)).all() == []


def test_dedupe_cards():
    cards = [
        CardDraft(question=" What is X? ", answer="a"),
        CardDraft(question="what is   x?", answer="b"),
        CardDraft(question="", answer="c"),
        CardDraft(question="Why?", answer="  "),
        CardDraft(question="What is Y?", answer="d"),
    ]
    assert [c.question for c in flashcards.dedupe_cards(cards)] == ["What is X?", "What is Y?"]


def test_text_is_chunked_and_merged(monkeypatch):
    calls = []

    class FakeResponses:
        async def parse(self, **kwargs):
            calls.append(kwargs)
            n = len(calls)
            return SimpleNamespace(
                output_parsed=CardSet(
                    cards=[CardDraft(question=f"Q{n}?", answer="A"),
                           CardDraft(question="Shared?", answer="A")]
                )
            )

    monkeypatch.setattr(flashcards, "get_client", lambda: SimpleNamespace(responses=FakeResponses()))
    monkeypatch.setattr(flashcards.config, "GENERATION_CHUNK_CHARS", 20)

    cards = asyncio.run(flashcards.generate_cards_from_text("aaaa bbbb cccc\n\ndddd eeee ffff", from_ocr=True))

    assert len(calls) == 2
    assert calls[0]["model"] == "gpt-5.6-sol"
    assert calls[0]["text_format"] is CardSet
    assert "OCR" in calls[0]["input"][0]["content"][0]["text"]
    assert sorted(c.question for c in cards) == ["Q1?", "Q2?", "Shared?"]
