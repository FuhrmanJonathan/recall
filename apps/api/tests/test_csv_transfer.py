"""CSV preview, import, export, validation, and ownership."""

import csv
import io

from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.test_auth import client, engine, signup  # noqa: F401
from recall_db.models import CardLabel, Deck, Flashcard


def upload(name="cards.csv", content=b"question,answer,tags\nQ,A,biology\n"):
    return {"file": (name, content, "text/csv")}


def test_csv_routes_require_login(client):
    assert client.post("/api/csv/preview", files=upload()).status_code == 401
    assert client.post("/api/csv/import", data={"title": "Deck"}, files=upload()).status_code == 401
    assert client.get("/api/csv/decks/1/export").status_code == 401


def test_imported_tags_work_with_colored_editor_and_legacy_filters(client):
    signup(client)
    imported = client.post("/api/csv/import", data={"title": "CSV"}, files=upload()).json()
    card = client.get(f"/api/decks/{imported['id']}").json()["flashcards"][0]
    response = client.put(f"/api/flashcards/{card['id']}/labels", json={
        "labels": [{"name": "Biology", "color": "green"}]
    })
    assert response.status_code == 200, response.text
    assert client.get("/api/labels").json() == ["biology"]
    assert client.get("/api/labels?colors=true").json() == [{"name": "biology", "color": "green"}]
    assert client.get("/api/study/cards?mode=practice&label=biology").json()["total"] == 1
    exported = client.get(f"/api/csv/decks/{imported['id']}/export")
    assert "biology" in exported.text


def test_preview_and_import_valid_rows_with_tags(client, engine):
    signup(client)
    content = (
        '\ufeffquestion,answer,tags\r\n'
        '"What is ATP?","Energy, stored in cells"," Biology, exam "\r\n'
        '"Question with\na newline","Multiline answer","cell biology"\r\n'
        ',Missing question,bad\r\n'
    ).encode()
    preview = client.post("/api/csv/preview", files=upload(content=content))
    assert preview.status_code == 200, preview.text
    assert preview.json() == {
        "filename": "cards.csv",
        "valid_count": 2,
        "skipped_count": 1,
        "cards": [
            {"row": 2, "question": "What is ATP?", "answer": "Energy, stored in cells", "tags": ["biology", "exam"]},
            {"row": 3, "question": "Question with\na newline", "answer": "Multiline answer", "tags": ["cell biology"]},
        ],
        "issues": ["Row 4: question and answer are required."],
        "issues_truncated": False,
    }
    result = client.post("/api/csv/import", data={"title": "  Imported Biology  "}, files=upload(content=content))
    assert result.status_code == 201, result.text
    assert result.json()["title"] == "Imported Biology"
    assert result.json()["card_count"] == 2
    assert result.json()["skipped_count"] == 1
    with Session(engine) as session:
        deck = session.scalar(select(Deck))
        cards = session.scalars(select(Flashcard).order_by(Flashcard.id)).all()
        assert deck.user_id == 1
        assert [card.question for card in cards] == ["What is ATP?", "Question with\na newline"]
        assert session.scalars(select(CardLabel.name).where(CardLabel.flashcard_id == cards[0].id).order_by(CardLabel.name)).all() == ["biology", "exam"]


def test_export_is_private_standard_csv_and_round_trips(client, engine):
    user = signup(client).json()
    with Session(engine) as session:
        deck = Deck(user_id=user["id"], title="Biology, Unit 1")
        deck.flashcards = [
            Flashcard(question="What, exactly?", answer="A \"quoted\" answer"),
            Flashcard(question="=unsafe formula", answer="@also unsafe"),
        ]
        session.add(deck)
        session.flush()
        session.add_all([
            CardLabel(flashcard_id=deck.flashcards[0].id, name="biology"),
            CardLabel(flashcard_id=deck.flashcards[0].id, name="exam"),
            CardLabel(flashcard_id=deck.flashcards[1].id, name="=unsafe tag"),
        ])
        session.commit()
        deck_id = deck.id
    response = client.get(f"/api/csv/decks/{deck_id}/export")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "filename*=UTF-8''Biology%2C%20Unit%201.csv" in response.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert rows == [
        {"question": "What, exactly?", "answer": 'A "quoted" answer', "tags": "biology,exam"},
        {"question": "'=unsafe formula", "answer": "'@also unsafe", "tags": "'=unsafe tag"},
    ]
    imported = client.post(
        "/api/csv/import",
        data={"title": "Round trip"},
        files=upload(content=response.content),
    )
    assert imported.status_code == 201, imported.text
    with Session(engine) as session:
        round_trip = session.scalar(select(Deck).where(Deck.id == imported.json()["id"]))
        assert [(card.question, card.answer) for card in round_trip.flashcards] == [
            ("What, exactly?", 'A "quoted" answer'),
            ("=unsafe formula", "@also unsafe"),
        ]
        second_card = round_trip.flashcards[1]
        assert session.scalars(
            select(CardLabel.name).where(CardLabel.flashcard_id == second_card.id)
        ).all() == ["=unsafe tag"]
    client.post("/api/auth/logout")
    signup(client, {"email": "other@example.com", "password": "study-password"})
    assert client.get(f"/api/csv/decks/{deck_id}/export").status_code == 404


def test_invalid_csv_never_creates_a_deck(client):
    signup(client)
    cases = [
        ("cards.txt", b"question,answer\nQ,A\n", 415),
        ("cards.csv", b"", 400),
        ("cards.csv", b"\xff\xfe", 400),
        ("cards.csv", b"front,back\nQ,A\n", 422),
        ("cards.csv", b"question,answer\n,\n", 422),
        ("cards.csv", b"question,question,answer\nQ,Q,A\n", 422),
    ]
    for filename, content, status in cases:
        response = client.post("/api/csv/import", data={"title": "No deck"}, files=upload(filename, content))
        assert response.status_code == status, response.text
    assert client.get("/api/decks").json() == []


def test_csv_limits_rows_content_tags_and_file_size(client):
    signup(client)
    too_many_rows = b"question,answer\n" + b"Q,A\n" * 1001
    assert client.post("/api/csv/preview", files=upload(content=too_many_rows)).status_code == 422
    too_many_tags = 'question,answer,tags\nQ,A,"' + ",".join(f"tag{i}" for i in range(11)) + '"\n'
    assert client.post("/api/csv/preview", files=upload(content=too_many_tags.encode())).status_code == 422
    oversized = b"question,answer\n" + b"Q," + b"x" * (2 * 1024 * 1024)
    assert client.post("/api/csv/preview", files=upload(content=oversized)).status_code == 413
