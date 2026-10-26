"""Upload notes -> extract text (if needed) -> OpenAI flashcards -> save as a Deck."""

import importlib.util
import os
from pathlib import PurePath
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select, update
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
from app.flashcards import (
    CardDraft,
    GenerationError,
    generate_cards_from_pdf,
    generate_cards_from_text,
    normalize_focus,
)
from app.ocr import OCRError, OCRUnavailableError, extract_text_from_image
from app.text import clean_text
from recall_db.models import Deck, Flashcard, User

router = APIRouter(prefix="/api")

_SIZE_LIMITS = {
    SourceKind.TEXT: config.MAX_UPLOAD_BYTES,
    SourceKind.PDF: config.MAX_DOCUMENT_BYTES,
    SourceKind.DOCX: config.MAX_DOCUMENT_BYTES,
    SourceKind.IMAGE: config.MAX_IMAGE_BYTES,
}


class CardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    question: str
    answer: str
    needs_review: bool = False


class DeckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    version: int = 1
    flashcards: list[CardOut]


class GeneratedDeckOut(DeckOut):
    source: str  # "pdf", "text", "docx" or "image"


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
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> GeneratedDeckOut:
    """Turn an uploaded file of class notes into a saved deck of flashcards.

    ``focus`` is optional free text (e.g. "DNA replication") telling the generator which
    topic to put extra emphasis on.
    """
    filename = file.filename or ""
    kind = detect_source_kind(filename)
    if kind is None:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type. Supported: {', '.join(SUPPORTED_EXTENSIONS)}",
        )

    limit = _SIZE_LIMITS[kind]
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(
            status_code=413, detail=f"File is too large (max {limit // 1_000_000} MB)."
        )

    try:
        cards = await _make_cards(kind, filename, data, normalize_focus(focus))
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
    deck = await run_in_threadpool(_save_deck, session, user, deck_title, cards)
    return GeneratedDeckOut(
        id=deck.id,
        title=deck.title,
        flashcards=[CardOut.model_validate(card) for card in deck.flashcards],
        source=kind.value,
    )


@router.get("/decks/{deck_id}")
def get_deck(
    deck_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> DeckOut:
    deck = session.get(Deck, deck_id)
    if deck is None or deck.user_id != user.id:
        raise HTTPException(status_code=404, detail="Deck not found.")
    return DeckOut(
        id=deck.id, title=deck.title, version=deck.version,
        flashcards=[CardOut.model_validate(card) for card in sorted(deck.flashcards, key=lambda card: card.id)],
    )


class DeckCardIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int | None = Field(default=None, gt=0)
    question: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2_000)]
    answer: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5_000)]
    needs_review: bool = False


class DeckUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    version: int = Field(ge=1)
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
    # Claim this revision before editing cards, so a stale tab cannot delete newer work.
    claimed = session.execute(update(Deck).where(
        Deck.id == deck_id, Deck.user_id == user.id, Deck.version == body.version,
    ).values(title=body.title, version=Deck.version + 1).execution_options(synchronize_session=False))
    if claimed.rowcount != 1:
        session.rollback()
        raise HTTPException(409, "This deck changed in another tab. Your edits have not been saved. Copy anything you need, then reload the latest deck.")
    # Deletions cascade to labels and reviews.
    kept = set(ids)
    for card_id, card in existing.items():
        if card_id not in kept:
            session.delete(card)
    for draft in body.flashcards:
        if draft.id is None:
            session.add(Flashcard(deck_id=deck.id, question=draft.question,
                                  answer=draft.answer, needs_review=draft.needs_review))
        else:
            card = existing[draft.id]
            card.question = draft.question
            card.answer = draft.answer
            card.needs_review = draft.needs_review
    session.commit()
    session.expire(deck)
    return DeckOut(
        id=deck.id, title=deck.title, version=deck.version,
        flashcards=[CardOut.model_validate(card) for card in sorted(deck.flashcards, key=lambda card: card.id)],
    )


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
    if "question" in changes:
        card.question = changes["question"]
    if "answer" in changes:
        card.answer = changes["answer"]
    if "needs_review" in changes:
        card.needs_review = changes["needs_review"]
    elif "question" in changes or "answer" in changes:
        card.needs_review = False
    session.commit()
    return CardOut.model_validate(card)


async def _make_cards(
    kind: SourceKind, filename: str, data: bytes, focus: str | None = None
) -> list[CardDraft]:
    # Prong 1a: PDFs go straight to OpenAI.
    if kind is SourceKind.PDF:
        if not data.startswith(PDF_MAGIC):
            raise ValueError("This file is not a valid PDF.")
        return await generate_cards_from_pdf(data, filename, focus=focus)

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

    return await generate_cards_from_text(text, from_ocr=from_ocr, focus=focus)


def _save_deck(session: Session, user: User, title: str, cards: list[CardDraft]) -> Deck:
    deck = Deck(title=title, user_id=user.id)
    deck.flashcards.extend(
        Flashcard(question=card.question, answer=card.answer, needs_review=card.needs_review)
        for card in cards
    )
    session.add(deck)
    session.commit()
    return deck
