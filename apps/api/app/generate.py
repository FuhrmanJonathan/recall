"""Upload notes -> extract text (if needed) -> OpenAI flashcards -> save as a Deck."""

from pathlib import PurePath

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict
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


class DeckOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    flashcards: list[CardOut]


class GeneratedDeckOut(DeckOut):
    source: str  # "pdf", "text", "docx" or "image"


@router.post("/flashcards/generate", status_code=201)
async def generate_flashcards(
    file: UploadFile,
    title: str | None = Form(default=None),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> GeneratedDeckOut:
    """Turn an uploaded file of class notes into a saved deck of flashcards."""
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
        cards = await _make_cards(kind, filename, data)
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
    return DeckOut.model_validate(deck)


async def _make_cards(kind: SourceKind, filename: str, data: bytes) -> list[CardDraft]:
    # Prong 1a: PDFs go straight to OpenAI.
    if kind is SourceKind.PDF:
        if not data.startswith(PDF_MAGIC):
            raise ValueError("This file is not a valid PDF.")
        return await generate_cards_from_pdf(data, filename)

    # Prong 1b: other readable documents -> plain text -> OpenAI.
    # Prong 2: written notes (images) -> OCR model -> plain text -> OpenAI.
    from_ocr = kind is SourceKind.IMAGE
    if kind is SourceKind.TEXT:
        raw = decode_text(data)
    elif kind is SourceKind.DOCX:
        raw = await run_in_threadpool(extract_docx_text, data)
    else:
        raw = await run_in_threadpool(extract_text_from_image, data)
        print("OCR TEXT:", repr(raw), flush=True)


    text = clean_text(raw)  # same cleanup the /api/text endpoints use
    if not text:
        if from_ocr:
            raise OCRError("No readable text was found in this image.")
        raise ValueError("Text is empty.")
    if len(text) > config.MAX_TEXT_CHARS:
        raise ValueError(f"Text is too long (max {config.MAX_TEXT_CHARS} characters).")

    return await generate_cards_from_text(text, from_ocr=from_ocr)


def _save_deck(session: Session, user: User, title: str, cards: list[CardDraft]) -> Deck:
    deck = Deck(title=title, user_id=user.id)
    deck.flashcards.extend(
        Flashcard(question=card.question, answer=card.answer) for card in cards
    )
    session.add(deck)
    session.commit()
    return deck
