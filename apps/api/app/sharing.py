"""Public, searchable flashcard decks. Private decks are never exposed."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_session
from recall_db.models import Deck, Flashcard, User

router = APIRouter(prefix="/api", tags=["sharing"])


class PublishIn(BaseModel):
    is_public: bool
    description: str = Field(default="", max_length=1000)
    subject: str = Field(default="", max_length=100)


class PublicDeck(BaseModel):
    id: int
    title: str
    description: str
    subject: str
    card_count: int


class SharedCard(BaseModel):
    question: str
    answer: str


class PublicDeckDetail(PublicDeck):
    flashcards: list[SharedCard]


@router.get("/public/decks", response_model=list[PublicDeck])
def discover_decks(
    q: str = Query(default="", max_length=100),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
):
    stmt = (select(Deck.id, Deck.title, Deck.description, Deck.subject,
                   func.count(Flashcard.id).label("card_count"))
            .outerjoin(Flashcard, Flashcard.deck_id == Deck.id)
            .where(Deck.is_public.is_(True)))
    if q.strip():
        needle = f"%{q.strip()}%"
        stmt = stmt.where(or_(Deck.title.ilike(needle), Deck.subject.ilike(needle),
                              Deck.description.ilike(needle)))
    stmt = stmt.group_by(Deck.id).order_by(Deck.created_at.desc(), Deck.id.desc()).offset(offset).limit(limit)
    return [dict(row._mapping) for row in session.execute(stmt)]


@router.get("/public/decks/{deck_id}", response_model=PublicDeckDetail)
def preview_public_deck(deck_id: int, session: Session = Depends(get_session)):
    deck = session.get(Deck, deck_id)
    if deck is None or not deck.is_public:
        raise HTTPException(404, "Public deck not found.")
    return PublicDeckDetail(id=deck.id, title=deck.title, description=deck.description,
                            subject=deck.subject, card_count=len(deck.flashcards),
                            flashcards=[SharedCard(question=c.question, answer=c.answer)
                                        for c in deck.flashcards])


@router.put("/decks/{deck_id}/sharing", response_model=PublicDeck)
def set_deck_sharing(
    deck_id: int, body: PublishIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    deck = session.get(Deck, deck_id)
    if deck is None or deck.user_id != user.id:
        raise HTTPException(404, "Deck not found.")
    if body.is_public and not deck.flashcards:
        raise HTTPException(422, "Add cards before publishing a deck.")
    deck.is_public = body.is_public
    deck.description = body.description.strip()
    deck.subject = body.subject.strip()
    session.commit()
    return PublicDeck(id=deck.id, title=deck.title, description=deck.description,
                      subject=deck.subject, card_count=len(deck.flashcards))


@router.post("/public/decks/{deck_id}/copy", status_code=201)
def copy_public_deck(
    deck_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    source = session.get(Deck, deck_id)
    if source is None or not source.is_public:
        raise HTTPException(404, "Public deck not found.")
    if len(source.flashcards) > 2000:
        raise HTTPException(422, "This deck is too large to copy.")
    deck = Deck(user_id=user.id, title=source.title,
                description=source.description, subject=source.subject,
                is_public=False)
    deck.flashcards.extend(Flashcard(question=c.question, answer=c.answer)
                           for c in source.flashcards)
    session.add(deck)
    session.commit()
    return {"id": deck.id, "title": deck.title, "card_count": len(deck.flashcards)}
