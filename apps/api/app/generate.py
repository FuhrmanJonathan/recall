"""Upload notes -> extract text (if needed) -> OpenAI flashcards -> save as a Deck."""

import importlib.util
import os
import zlib
from collections import Counter
from pathlib import PurePath
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app import config
from app.deps import get_current_user, get_session
from app.documents import (
    PDF_MAGIC,
    SUPPORTED_EXTENSIONS,
    SourceKind,
    decode_text,
    detect_source_kind,
    extract_docx_text,
)
from app.quiz_questions import preserve_question
from app.flashcards import (
    TAG_MODES,
    CardDraft,
    GenerationError,
    generate_cards_from_pdf,
    generate_cards_from_text,
    normalize_focus,
)
from app.ocr import OCRError, OCRUnavailableError, extract_text_from_image
from app.study import normalize_label
from app.text import clean_text
from recall_db.models import COLORS, CardTag, Deck, DeckLabel, Flashcard, User

router = APIRouter(prefix="/api")

# "general" -> deck labels (broad topics). "specific" -> card tags (exact concepts).
_MAX_LABELS = {"general": 2, "specific": 4}   # kept per card from the model's output
_MAX_DECK_LABELS = 3                          # auto-generated deck labels
_MAX_ITEMS = 10                               # labels per deck / tags per card

_SIZE_LIMITS = {
    SourceKind.TEXT: config.MAX_UPLOAD_BYTES,
    SourceKind.PDF: config.MAX_DOCUMENT_BYTES,
    SourceKind.DOCX: config.MAX_DOCUMENT_BYTES,
    SourceKind.IMAGE: config.MAX_IMAGE_BYTES,
}


def default_color(name: str) -> str:
    return COLORS[zlib.crc32(name.encode()) % len(COLORS)]


class ImageOut(BaseModel):
    """Image metadata only. The bytes are served by GET /api/images/{id}."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    side: str
    
class NamedOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    color: str

class NamedIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    color: str = ""


class CardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question: str
    answer: str
    needs_review: bool = False
    tags: list[NamedOut] = []
    images: list[ImageOut] = []

    @field_validator("tags")
    @classmethod
    def _sorted_tags(cls, v: list[NamedOut]) -> list[NamedOut]:
        return sorted(v, key=lambda t: t.name)


class DeckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    version: int = 1
    labels: list[NamedOut] = []
    flashcards: list[CardOut]


class GeneratedDeckOut(DeckOut):
    source: str  # "pdf", "text", "docx" or "image"


def _deck_out(deck: Deck) -> DeckOut:
    return DeckOut(
        id=deck.id, title=deck.title, version=deck.version,
        labels=[NamedOut.model_validate(l) for l in sorted(deck.labels, key=lambda l: l.name)],
        flashcards=[CardOut.model_validate(c) for c in sorted(deck.flashcards, key=lambda c: c.id)],
    )


def clean_items(raw: list[NamedIn], limit: int, known: dict[str, str]) -> dict[str, str]:
    """Normalize names to {name: color}. A color already stored for the name always wins."""
    out: dict[str, str] = {}
    for item in raw:
        name = " ".join(item.name.lower().split())
        if not name:
            continue
        if len(name) > 40:
            raise HTTPException(422, "Labels and tags can be up to 40 characters.")
        color = known.get(name) or (item.color if item.color in COLORS else default_color(name))
        out.setdefault(name, color)
    if len(out) > limit:
        raise HTTPException(422, f"Use up to {limit} per deck or card.")
    return out


def sync_items(rel: list, model: type, items: dict[str, str]) -> None:
    """Remove rows that are gone and add new ones. Existing rows keep their color."""
    for row in list(rel):
        if row.name not in items:
            rel.remove(row)
    have = {row.name for row in rel}
    for name, color in items.items():
        if name not in have:
            rel.append(model(name=name, color=color))


def known_label_colors(session: Session, user_id: int) -> dict[str, str]:
    """One color per label name across all of this user's decks."""
    rows = session.execute(
        select(DeckLabel.name, func.min(DeckLabel.color))
        .join(Deck, Deck.id == DeckLabel.deck_id)
        .where(Deck.user_id == user_id)
        .group_by(DeckLabel.name)
    ).all()
    return {name: color for name, color in rows}


@router.get("/flashcards/status")
def generation_status(user: User = Depends(get_current_user)) -> dict[str, bool]:
    """Read configuration only; never validate credentials with a paid request."""
    return {
        "configured": bool(os.getenv("OPENAI_API_KEY", "").strip()),
        "images_available": all(importlib.util.find_spec(name) is not None for name in ("PIL", "torch", "transformers")),
    }


@router.post("/flashcards/generate", status_code=201)
async def generate_flashcards(
    file: UploadFile,
    title: str | None = Form(default=None),
    focus: str | None = Form(default=None, max_length=config.MAX_FOCUS_CHARS),
    tag_mode: str | None = Form(default=None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> GeneratedDeckOut:
    """Turn an uploaded file of class notes into a saved deck of flashcards.

    ``focus`` is optional free text (e.g. "DNA replication") telling the generator which
    topic to put extra emphasis on. ``tag_mode`` is optional too: ``"general"`` gives the
    deck up to 3 broad labels, ``"specific"`` gives each card 2-4 exact tags.
    Leave it out for neither.
    """
    filename = file.filename or ""
    kind = detect_source_kind(filename)
    if kind is None:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type. Supported: {', '.join(SUPPORTED_EXTENSIONS)}",
        )

    mode = (tag_mode or "").strip().lower() or None
    if mode is not None and mode not in TAG_MODES:
        raise HTTPException(status_code=422, detail="tag_mode must be 'general' or 'specific'.")

    limit = _SIZE_LIMITS[kind]
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            status_code=413, detail=f"File is too large (max {limit // 1_000_000} MB)."
        )

    try:
        cards = await _make_cards(kind, filename, data, normalize_focus(focus), mode)
    except OCRUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except OCRError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except GenerationError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if not cards:
        raise HTTPException(status_code=422, detail="No flashcards could be generated.")

    deck_title = (title or PurePath(filename).stem or "Untitled deck").strip()[:200]
    deck = await run_in_threadpool(_save_deck, session, user, deck_title, cards, mode)
    return GeneratedDeckOut(**_deck_out(deck).model_dump(), source=kind.value)


@router.get("/decks/{deck_id}")
def get_deck(
    deck_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> DeckOut:
    deck = session.get(Deck, deck_id)
    if deck is None or deck.user_id != user.id:
        raise HTTPException(status_code=404, detail="Deck not found.")
    return _deck_out(deck)


class DeckCardIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int | None = Field(default=None, gt=0)
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2_000)]
    answer: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5_000)]
    needs_review: bool = False
    tags: list[NamedIn] = Field(default_factory=list, max_length=_MAX_ITEMS)
    # The editor echoes each card's images back. Accept and ignore them, so a save can
    # never add, change, or delete an image (those use /api/cards/{id}/images).
    images: list[Any] = Field(default_factory=list, exclude=True)


class DeckUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    version: int = Field(ge=1)
    labels: list[NamedIn] = Field(default_factory=list, max_length=_MAX_ITEMS)
    flashcards: list[DeckCardIn] = Field(max_length=1000)


@router.put("/decks/{deck_id}")
def update_deck(
    deck_id: int,
    body: DeckUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> DeckOut:
    """Save an entire edit in one transaction, preserving retained cards' study history."""
    deck = session.scalar(select(Deck).where(Deck.id == deck_id, Deck.user_id == user.id))
    if deck is None:
        raise HTTPException(404, "Deck not found.")
    if deck.version != body.version:
        raise HTTPException(409, "This deck changed in another tab. Your edits have not been saved. Copy anything you need, then reload the latest deck.")
    existing = {card.id: card for card in deck.flashcards}
    ids = [card.id for card in body.flashcards if card.id is not None]
    if len(ids) != len(set(ids)) or any(card_id not in existing for card_id in ids):
        raise HTTPException(422, "Cards must belong to this deck and appear only once. Reload the deck and try again.")

    # Validate labels and tags BEFORE touching anything. Tag colors are scoped to this deck:
    # a name already used in this deck keeps its color, and later cards in this save agree.
    label_items = clean_items(body.labels, _MAX_ITEMS, known_label_colors(session, user.id))
    tag_colors = {t.name: t.color for c in deck.flashcards for t in c.tags}
    tag_items: list[dict[str, str]] = []
    for draft in body.flashcards:
        items = clean_items(draft.tags, _MAX_ITEMS, tag_colors)
        for name, color in items.items():
            tag_colors.setdefault(name, color)
        tag_items.append(items)

    # Claim this revision before editing cards, so a stale tab cannot delete newer work.
    claimed = session.execute(update(Deck).where(
        Deck.id == deck_id, Deck.user_id == user.id, Deck.version == body.version,
    ).values(title=body.title, version=Deck.version + 1).execution_options(synchronize_session=False))
    if claimed.rowcount != 1:
        session.rollback()
        raise HTTPException(409, "This deck changed in another tab. Your edits have not been saved. Copy anything you need, then reload the latest deck.")
    # Deletions cascade to tags, images, and reviews.
    kept = set(ids)
    for card_id, card in existing.items():
        if card_id not in kept:
            session.delete(card)
    sync_items(deck.labels, DeckLabel, label_items)
    for draft, items in zip(body.flashcards, tag_items):
        if draft.id is None:
            session.add(Flashcard(
                deck_id=deck.id, question=draft.question, answer=draft.answer,
                needs_review=draft.needs_review,
                tags=[CardTag(name=n, color=c) for n, c in items.items()],
            ))
        else:
            card = existing[draft.id]
            preserve_question(card)
            card.question = draft.question
            card.answer = draft.answer
            card.needs_review = draft.needs_review
            _drop_stale_blank(card)
            sync_items(card.tags, CardTag, items)
    session.commit()
    session.expire(deck)
    return _deck_out(deck)


class CardUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2_000)] | None = None
    answer: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5_000)] | None = None
    needs_review: bool | None = None


@router.patch("/flashcards/{card_id}")
def update_flashcard(
    card_id: int,
    body: CardUpdate,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> CardOut:
    """Edit a card's text and/or its "needs review" flag.

    Editing the question or answer clears the flag unless ``needs_review`` is sent too.
    """
    card = session.scalar(
        select(Flashcard).join(Deck).where(Flashcard.id == card_id, Deck.user_id == user.id)
    )
    if card is None:
        raise HTTPException(status_code=404, detail="Flashcard not found.")

    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise HTTPException(status_code=422, detail="Nothing to update.")

    # Single-card edits must also invalidate open whole-deck editors.
    session.execute(update(Deck).where(Deck.id == card.deck_id).values(version=Deck.version + 1))
    preserve_question(card)
    if "question" in changes:
        card.question = changes["question"]
    if "answer" in changes:
        card.answer = changes["answer"]
        _drop_stale_blank(card)
    if "needs_review" in changes:
        card.needs_review = changes["needs_review"]
    elif "question" in changes or "answer" in changes:
        card.needs_review = False
    session.commit()
    return CardOut.model_validate(card)


def _drop_stale_blank(card: Flashcard) -> None:
    """An edited answer that no longer contains the stored quiz blank can't use it."""
    if card.cloze_blank and card.cloze_blank not in card.answer:
        card.cloze_blank = None


async def _make_cards(
    kind: SourceKind, filename: str, data: bytes, focus: str | None = None,
    tag_mode: str | None = None,
) -> list[CardDraft]:
    # Prong 1a: PDFs go straight to OpenAI.
    if kind is SourceKind.PDF:
        if not data.startswith(PDF_MAGIC):
            raise ValueError("This file is not a valid PDF.")
        return await generate_cards_from_pdf(data, filename, focus=focus, tag_mode=tag_mode)

    # Prong 1b: other readable documents -> plain text -> OpenAI.
    # Prong 2: written notes (images) -> OCR model -> plain text -> OpenAI.
    from_ocr = kind is SourceKind.IMAGE
    if kind is SourceKind.TEXT:
        raw = decode_text(data)
    elif kind is SourceKind.DOCX:
        raw = await run_in_threadpool(extract_docx_text, data)
    else:
        raw = await run_in_threadpool(extract_text_from_image, data)

    text = clean_text(raw)  # same cleanup the /api/text endpoints use
    if not text:
        if from_ocr:
            raise OCRError("No readable text was found in this image.")
        raise ValueError("Text is empty.")
    if len(text) > config.MAX_TEXT_CHARS:
        raise ValueError(f"Text is too long (max {config.MAX_TEXT_CHARS} characters).")

    return await generate_cards_from_text(text, from_ocr=from_ocr, focus=focus, tag_mode=tag_mode)


def _clean_labels(raw: list[str], tag_mode: str | None) -> list[str]:
    """Normalize model labels the same way the Study page does; drop bad ones and cap by mode."""
    if tag_mode not in _MAX_LABELS:
        return []  # nothing was asked for, so ignore anything the model sent anyway
    labels: list[str] = []
    for name in raw:
        try:
            label = normalize_label(name)
        except ValueError:
            continue
        if label not in labels:
            labels.append(label)
    return labels[: _MAX_LABELS[tag_mode]]


def _save_deck(
    session: Session, user: User, title: str, cards: list[CardDraft], tag_mode: str | None = None
) -> Deck:
    deck = Deck(title=title, user_id=user.id)
    flashcards = [
        Flashcard(
            question=card.question, answer=card.answer,
            needs_review=card.needs_review, cloze_blank=card.cloze_blank or None,
        )
        for card in cards
    ]
    for flashcard in flashcards:
        preserve_question(flashcard)

    names = [_clean_labels(card.labels, tag_mode) for card in cards]
    if tag_mode == "general":
        # Broad topics become DECK labels: the most common ones across all cards.
        known = known_label_colors(session, user.id)
        top = Counter(n for ns in names for n in ns).most_common(_MAX_DECK_LABELS)
        deck.labels = [DeckLabel(name=n, color=known.get(n) or default_color(n)) for n, _ in top]
    elif tag_mode == "specific":
        # Exact concepts become CARD tags, scoped to this deck.
        for flashcard, ns in zip(flashcards, names):
            flashcard.tags = [CardTag(name=n, color=default_color(n)) for n in ns]

    deck.flashcards.extend(flashcards)
    session.add(deck)
    session.commit()
    return deck