"""Where did this card come from? Points a flashcard back into the notes it was made from."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, undefer

from app.deps import get_current_user, get_session
from app.source_match import best_passage, context, locate
from recall_db.models import Deck, DeckSource, Flashcard, User

router = APIRouter(prefix="/api", tags=["sources"])


class SourceContext(BaseModel):
    before: str
    match: str
    after: str
    more_before: bool
    more_after: bool


class CardSourceOut(BaseModel):
    card_id: int
    deck_id: int
    deck_title: str
    question: str
    answer: str
    # False when the deck has no saved notes and the card has no excerpt (older or
    # hand-made decks, CSV imports, copies of shared decks).
    available: bool
    kind: Literal["text", "docx", "pdf", "image"] | None = None
    filename: str = ""
    # The passage the generator said the card came from, word for word.
    excerpt: str | None = None
    page: int | None = None
    # "excerpt": found the generator's passage; "guess": best keyword match for cards
    # without one; None: nothing to highlight (show the excerpt and/or the file instead).
    match: Literal["excerpt", "guess"] | None = None
    context: SourceContext | None = None
    file_url: str | None = None


def _owned_card(session: Session, card_id: int, user: User) -> tuple[Flashcard, Deck]:
    row = session.execute(
        select(Flashcard, Deck).join(Deck).where(Flashcard.id == card_id, Deck.user_id == user.id)
    ).first()
    if row is None:
        raise HTTPException(404, "Flashcard not found.")
    return row[0], row[1]


@router.get("/flashcards/{card_id}/source")
def card_source(
    card_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> CardSourceOut:
    card, deck = _owned_card(session, card_id, user)
    source = session.scalar(select(DeckSource).where(DeckSource.deck_id == deck.id))
    out = CardSourceOut(
        card_id=card.id, deck_id=deck.id, deck_title=deck.title,
        question=card.question, answer=card.answer,
        available=source is not None or bool(card.source_excerpt),
        excerpt=card.source_excerpt, page=card.source_page,
    )
    if source is None:
        return out

    out.kind = source.kind  # type: ignore[assignment]
    out.filename = source.filename
    if source.text:
        span = locate(source.text, card.source_excerpt)
        out.match = "excerpt" if span else None
        if span is None:
            span = best_passage(source.text, card.question, card.answer)
            out.match = "guess" if span else None
        if span is not None:
            out.context = SourceContext(**context(source.text, *span))
    elif source.content_type:
        out.file_url = f"/api/decks/{deck.id}/source/file"
    return out


@router.get("/decks/{deck_id}/source/file")
def deck_source_file(
    deck_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> Response:
    """The original PDF or photo the deck was generated from (owner only)."""
    source = session.scalar(
        select(DeckSource).join(Deck).options(undefer(DeckSource.data))
        .where(DeckSource.deck_id == deck_id, Deck.user_id == user.id)
    )
    if source is None or not source.data or not source.content_type:
        raise HTTPException(404, "Original notes not found.")
    safe_name = "".join(c for c in source.filename if c.isalnum() or c in " ._-") or "notes"
    return Response(
        content=source.data,
        media_type=source.content_type,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": f'inline; filename="{safe_name}"',
        },
    )
