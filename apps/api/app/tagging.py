from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_session
from recall_db.models import COLORS, CardTag, Deck, DeckLabel, Flashcard, User

router = APIRouter(prefix="/api", tags=["labels"])


class ColorIn(BaseModel):
    name: str
    color: str


def _owned_deck(session: Session, deck_id: int, user: User) -> Deck:
    deck = session.get(Deck, deck_id)
    if deck is None or deck.user_id != user.id:
        raise HTTPException(404, "Deck not found.")
    return deck


@router.get("/decks/{deck_id}/tags")
def list_deck_tags(deck_id: int, user: User = Depends(get_current_user),
                   session: Session = Depends(get_session)):
    """Tags exist only inside a deck, so this always needs a deck id."""
    _owned_deck(session, deck_id, user)
    rows = session.execute(
        select(CardTag.name, func.count(), func.min(CardTag.color))
        .join(Flashcard, Flashcard.id == CardTag.flashcard_id)
        .where(Flashcard.deck_id == deck_id)
        .group_by(CardTag.name).order_by(CardTag.name)
    ).all()
    return [{"name": n, "count": c, "color": col} for n, c, col in rows]


@router.put("/decks/{deck_id}/tags/color")
def set_tag_color(deck_id: int, body: ColorIn, user: User = Depends(get_current_user),
                  session: Session = Depends(get_session)):
    if body.color not in COLORS:
        raise HTTPException(422, "Unknown color.")
    _owned_deck(session, deck_id, user)
    session.execute(
        update(CardTag)
        .where(CardTag.name == body.name,
               CardTag.flashcard_id.in_(select(Flashcard.id).where(Flashcard.deck_id == deck_id)))
        .values(color=body.color)
    )
    session.commit()
    return {"name": body.name, "color": body.color}


@router.put("/labels/color")
def set_label_color(body: ColorIn, user: User = Depends(get_current_user),
                    session: Session = Depends(get_session)):
    """Recolors this label on every one of the user's decks that has it."""
    if body.color not in COLORS:
        raise HTTPException(422, "Unknown color.")
    session.execute(
        update(DeckLabel)
        .where(DeckLabel.name == body.name,
               DeckLabel.deck_id.in_(select(Deck.id).where(Deck.user_id == user.id)))
        .values(color=body.color)
    )
    session.commit()
    return {"name": body.name, "color": body.color}