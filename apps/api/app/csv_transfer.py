"""Import and export user-owned flashcard decks as UTF-8 CSV files."""

from dataclasses import dataclass
import csv
import io
from pathlib import PurePath
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_session
from app.study import normalize_label
from recall_db.models import CardLabel, Deck, Flashcard, User

router = APIRouter(prefix="/api/csv", tags=["csv"])

MAX_CSV_BYTES = 2 * 1024 * 1024
MAX_CSV_ROWS = 1_000
MAX_QUESTION_CHARS = 2_000
MAX_ANSWER_CHARS = 5_000
MAX_LABELS_PER_CARD = 10
PREVIEW_CARDS = 10
PREVIEW_ISSUES = 50
FORMULA_PREFIXES = ("=", "+", "-", "@")


class PreviewCard(BaseModel):
    row: int
    question: str
    answer: str
    tags: list[str]


class CsvPreview(BaseModel):
    filename: str
    valid_count: int
    skipped_count: int
    cards: list[PreviewCard]
    issues: list[str]
    issues_truncated: bool


class CsvImportOut(BaseModel):
    id: int
    title: str
    card_count: int
    skipped_count: int


@dataclass(frozen=True)
class ParsedCard:
    row: int
    question: str
    answer: str
    tags: list[str]


@dataclass(frozen=True)
class ParsedCsv:
    cards: list[ParsedCard]
    issues: list[str]
    skipped_count: int
    issues_truncated: bool


async def _uploaded_csv(file: UploadFile) -> tuple[str, bytes]:
    filename = PurePath(file.filename or "").name
    if PurePath(filename).suffix.lower() != ".csv":
        raise HTTPException(415, "Choose a .csv file.")
    data = await file.read(MAX_CSV_BYTES + 1)
    if not data:
        raise HTTPException(400, "The CSV file is empty.")
    if len(data) > MAX_CSV_BYTES:
        raise HTTPException(413, "CSV file is too large (max 2 MB).")
    return filename, data


def _issue(issues: list[str], message: str) -> bool:
    if len(issues) < PREVIEW_ISSUES:
        issues.append(message)
        return False
    return True


def _parse_csv(data: bytes) -> ParsedCsv:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(400, "CSV must be UTF-8 encoded.") from exc
    if "\x00" in text:
        raise HTTPException(400, "CSV contains unsupported null characters.")

    try:
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        if reader.fieldnames is None:
            raise HTTPException(422, "CSV must include a header row.")
        headers = [header.strip().casefold() if header is not None else "" for header in reader.fieldnames]
        if len(headers) != len(set(headers)):
            raise HTTPException(422, "CSV header names must be unique.")
        if not {"question", "answer"}.issubset(headers):
            raise HTTPException(422, "CSV must include question and answer columns.")
        names = dict(zip(headers, reader.fieldnames))

        cards: list[ParsedCard] = []
        issues: list[str] = []
        skipped = 0
        truncated = False
        rows_seen = 0
        for row_number, row in enumerate(reader, start=2):
            if not any(str(value or "").strip() for value in row.values() if not isinstance(value, list)):
                continue
            rows_seen += 1
            if rows_seen > MAX_CSV_ROWS:
                raise HTTPException(422, f"CSV can contain at most {MAX_CSV_ROWS} data rows.")
            if None in row:
                skipped += 1
                truncated |= _issue(issues, f"Row {row_number}: too many columns.")
                continue
            question = _restore_spreadsheet_safe((row.get(names["question"]) or "").strip())
            answer = _restore_spreadsheet_safe((row.get(names["answer"]) or "").strip())
            if not question or not answer:
                skipped += 1
                truncated |= _issue(issues, f"Row {row_number}: question and answer are required.")
                continue
            if len(question) > MAX_QUESTION_CHARS or len(answer) > MAX_ANSWER_CHARS:
                skipped += 1
                truncated |= _issue(
                    issues,
                    f"Row {row_number}: question or answer exceeds the length limit.",
                )
                continue
            try:
                tag_cell = _restore_spreadsheet_safe(
                    (row.get(names.get("tags", "")) or "").strip()
                ) if "tags" in names else ""
                raw_tags = tag_cell.split(",") if tag_cell else []
                tags = sorted({normalize_label(tag) for tag in raw_tags if tag.strip()})
                if len(tags) > MAX_LABELS_PER_CARD:
                    raise ValueError(f"Cards can have at most {MAX_LABELS_PER_CARD} tags.")
            except ValueError as exc:
                skipped += 1
                truncated |= _issue(issues, f"Row {row_number}: {exc}")
                continue
            cards.append(ParsedCard(row_number, question, answer, tags))
    except csv.Error as exc:
        raise HTTPException(422, f"CSV could not be parsed: {exc}.") from exc

    if not cards:
        raise HTTPException(422, "CSV has no valid flashcards to import.")
    return ParsedCsv(cards, issues, skipped, truncated)


@router.post("/preview", response_model=CsvPreview)
async def preview_csv(
    file: UploadFile,
    user: User = Depends(get_current_user),
):
    del user  # Authentication is required even though preview does not persist data.
    filename, data = await _uploaded_csv(file)
    parsed = _parse_csv(data)
    return CsvPreview(
        filename=filename,
        valid_count=len(parsed.cards),
        skipped_count=parsed.skipped_count,
        cards=[PreviewCard(row=card.row, question=card.question, answer=card.answer, tags=card.tags)
               for card in parsed.cards[:PREVIEW_CARDS]],
        issues=parsed.issues,
        issues_truncated=parsed.issues_truncated,
    )


DeckTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


@router.post("/import", status_code=201, response_model=CsvImportOut)
async def import_csv(
    file: UploadFile,
    title: DeckTitle = Form(),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    _, data = await _uploaded_csv(file)
    parsed = _parse_csv(data)
    clean_title = title.strip()
    if not clean_title or len(clean_title) > 200:
        raise HTTPException(422, "Deck title must contain 1–200 characters.")
    deck = Deck(user_id=user.id, title=clean_title)
    session.add(deck)
    session.flush()
    cards: list[tuple[Flashcard, ParsedCard]] = []
    for source in parsed.cards:
        card = Flashcard(deck_id=deck.id, question=source.question, answer=source.answer)
        session.add(card)
        cards.append((card, source))
    session.flush()
    session.add_all([
        CardLabel(flashcard_id=card.id, name=tag)
        for card, source in cards for tag in source.tags
    ])
    session.commit()
    return CsvImportOut(
        id=deck.id,
        title=deck.title,
        card_count=len(cards),
        skipped_count=parsed.skipped_count,
    )


def _spreadsheet_safe(value: str) -> str:
    """Prevent spreadsheet programs from executing imported text as a formula."""
    return "'" + value if value.startswith(FORMULA_PREFIXES) else value


def _restore_spreadsheet_safe(value: str) -> str:
    """Undo the neutralizing apostrophe added by Recall exports."""
    return value[1:] if len(value) > 1 and value[0] == "'" and value[1] in FORMULA_PREFIXES else value


@router.get("/decks/{deck_id}/export")
def export_csv(
    deck_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    deck = session.scalar(select(Deck).where(Deck.id == deck_id, Deck.user_id == user.id))
    if deck is None:
        raise HTTPException(404, "Deck not found.")
    cards = sorted(deck.flashcards, key=lambda card: card.id)
    labels: dict[int, list[str]] = {card.id: [] for card in cards}
    if labels:
        for card_id, name in session.execute(
            select(CardLabel.flashcard_id, CardLabel.name)
            .where(CardLabel.flashcard_id.in_(labels)).order_by(CardLabel.name)
        ):
            labels[card_id].append(name)

    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["question", "answer", "tags"])
    for card in cards:
        writer.writerow([
            _spreadsheet_safe(card.question),
            _spreadsheet_safe(card.answer),
            _spreadsheet_safe(",".join(labels[card.id])),
        ])
    filename = quote(f"{deck.title}.csv", safe="")
    return Response(
        "\ufeff" + output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename=recall-deck.csv; filename*=UTF-8''{filename}",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
