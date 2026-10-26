"""Read-only study queues and user-owned card labels. Practice never changes reviews."""

from datetime import datetime
from typing import Literal
import unicodedata

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, case, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import reviews
from app.deps import get_current_user, get_session
from recall_db.models import CardLabel, CardReviewState, Deck, Flashcard, User

router = APIRouter(prefix="/api", tags=["study"])


def normalize_label(value: str) -> str:
    value = " ".join(unicodedata.normalize("NFKC", value).split()).casefold()
    if not value or len(value) > 40 or "," in value:
        raise ValueError("Labels must contain 1–40 characters and no commas.")
    return value


class LabelsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    labels: list[str] = Field(max_length=10)

    @field_validator("labels")
    @classmethod
    def clean_labels(cls, labels: list[str]) -> list[str]:
        return sorted({normalize_label(label) for label in labels})


class StudyCard(BaseModel):
    id: int
    deck_id: int
    deck_title: str
    question: str
    answer: str
    labels: list[str]
    due_at: datetime | None
    status: Literal["new", "due", "upcoming"]


class StudyQueue(BaseModel):
    cards: list[StudyCard]
    total: int
    offset: int
    limit: int


@router.get("/labels", response_model=list[str])
def list_labels(
    response: Response,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    response.headers["Cache-Control"] = "no-store"
    return session.scalars(
        select(CardLabel.name).join(Flashcard).join(Deck)
        .where(Deck.user_id == user.id).distinct().order_by(CardLabel.name)
    ).all()


@router.put("/flashcards/{card_id}/labels", response_model=LabelsIn)
def set_labels(
    card_id: int, body: LabelsIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    card = session.scalar(select(Flashcard).join(Deck).where(
        Flashcard.id == card_id, Deck.user_id == user.id
    ))
    if card is None:
        raise HTTPException(404, "Flashcard not found.")
    try:
        session.execute(delete(CardLabel).where(CardLabel.flashcard_id == card.id))
        session.add_all([CardLabel(flashcard_id=card.id, name=name) for name in body.labels])
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(409, "Labels changed. Reload and try again.") from exc
    return body


@router.get("/study/cards", response_model=StudyQueue)
def study_cards(
    response: Response,
    mode: Literal["due", "practice"] = "due",
    deck_id: int | None = Query(default=None, gt=0),
    label: str | None = Query(default=None, max_length=100),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    response.headers["Cache-Control"] = "no-store"
    if deck_id is not None and session.scalar(select(Deck.id).where(
        Deck.id == deck_id, Deck.user_id == user.id
    )) is None:
        raise HTTPException(404, "Deck not found.")
    now = reviews._now()
    statement = select(Flashcard, Deck.title, CardReviewState).join(Deck).outerjoin(
        CardReviewState, and_(
            CardReviewState.flashcard_id == Flashcard.id,
            CardReviewState.user_id == user.id,
        )
    ).where(Deck.user_id == user.id)
    if deck_id is not None:
        statement = statement.where(Deck.id == deck_id)
    if label is not None:
        try:
            normalized = normalize_label(label)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        statement = statement.where(select(CardLabel.flashcard_id).where(
            CardLabel.flashcard_id == Flashcard.id, CardLabel.name == normalized
        ).exists())
    if mode == "due":
        statement = statement.where(or_(
            CardReviewState.due_at.is_(None), CardReviewState.due_at <= now
        ))
    total = session.scalar(select(func.count()).select_from(statement.subquery()))
    # Oldest due first, then new cards, then future cards in practice mode.
    priority = case(
        (CardReviewState.due_at <= now, 0),
        (CardReviewState.due_at.is_(None), 1), else_=2,
    )
    rows = session.execute(statement.order_by(
        priority, CardReviewState.due_at, Flashcard.id
    ).offset(offset).limit(limit)).all()
    ids = [card.id for card, _, _ in rows]
    labels: dict[int, list[str]] = {card_id: [] for card_id in ids}
    if ids:
        for card_id, name in session.execute(select(CardLabel.flashcard_id, CardLabel.name)
                .where(CardLabel.flashcard_id.in_(ids)).order_by(CardLabel.name)):
            labels[card_id].append(name)
    cards = []
    for card, title, state in rows:
        due = reviews._stored_utc(state.due_at) if state else None
        cards.append(StudyCard(
            id=card.id, deck_id=card.deck_id, deck_title=title,
            question=card.question, answer=card.answer, labels=labels[card.id],
            due_at=due, status="new" if due is None else "due" if due <= now else "upcoming",
        ))
    return StudyQueue(cards=cards, total=total or 0, offset=offset, limit=limit)
