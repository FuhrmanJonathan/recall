"""Storing SM-2 state and history to the database together."""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.deps import get_current_user, get_session
from app.sm2 import ReviewState, review_rating
from recall_db.models import CardReviewState, Deck, Flashcard, Review, StudyActivity, User

router = APIRouter(prefix="/api", tags=["reviews"])


class ReviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    flashcard_id: int = Field(strict=True, gt=0)
    rating: Literal["Again", "Hard", "Good", "Easy"]

    @field_validator("rating", mode="before")
    @classmethod
    def normalize_rating(cls, value):
        return value.capitalize() if isinstance(value, str) else value


class ReviewOut(BaseModel):
    review_id: int
    flashcard_id: int
    rating: str
    quality: int
    repetitions: int
    interval_days: int
    ease_factor: float
    last_reviewed_at: datetime
    due_at: datetime


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _stored_utc(value: datetime | None) -> datetime | None:
    # All writes use UTC. SQLite drops tzinfo when reading DateTime columns.
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


@router.post("/reviews", status_code=201, response_model=ReviewOut)
def submit_review(
    body: ReviewIn,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> ReviewOut:
    card = session.scalar(
        select(Flashcard).join(Deck).where(
            Flashcard.id == body.flashcard_id, Deck.user_id == user.id
        )
    )
    if card is None:
        raise HTTPException(404, "Flashcard not found.")

    saved = session.get(CardReviewState, (user.id, card.id))
    previous = ReviewState() if saved is None else ReviewState(
        repetitions=saved.repetitions,
        interval_days=saved.interval_days,
        ease_factor=saved.ease_factor,
        last_reviewed_at=_stored_utc(saved.last_reviewed_at),
        due_at=_stored_utc(saved.due_at),
    )
    now = _now()
    # This endpoint advances daily scheduling, not free practice or relearning.
    if previous.due_at is not None and now < previous.due_at:
        raise HTTPException(409, "This card is not due yet.")
    if previous.last_reviewed_at is not None and now <= previous.last_reviewed_at:
        raise HTTPException(409, "Review time must follow the previous review.")

    result = review_rating(previous, body.rating, reviewed_at=now)
    state = result.state
    if saved is None:
        saved = CardReviewState(user_id=user.id, flashcard_id=card.id)
        session.add(saved)
    saved.repetitions = state.repetitions
    saved.interval_days = state.interval_days
    saved.ease_factor = state.ease_factor
    saved.last_reviewed_at = state.last_reviewed_at
    saved.due_at = state.due_at
    event = Review(
        user_id=user.id, flashcard_id=card.id, rating=body.rating, created_at=now
    )
    session.add(event)
    # Record review in the same transaction as the
    # review history and SM-2 state. 
    with session.no_autoflush:
        activity = session.scalar(
            select(StudyActivity).where(
                StudyActivity.user_id == user.id,
                StudyActivity.study_date == now.date(),
        )
    )
    if activity is None:
        session.add(StudyActivity(
            user_id=user.id, study_date=now.date(), cards_reviewed=1,
        ))
    else:
        activity.cards_reviewed += 1
    try:
        session.flush()
        response = ReviewOut(
            review_id=event.id, flashcard_id=card.id, rating=body.rating,
            quality=result.quality, repetitions=state.repetitions,
            interval_days=state.interval_days, ease_factor=state.ease_factor,
            last_reviewed_at=now, due_at=state.due_at,
        )
        session.commit()
    except (IntegrityError, StaleDataError) as exc:
        session.rollback()
        raise HTTPException(409, "Review state changed. Reload before reviewing again.") from exc
    except Exception:
        session.rollback()
        raise
    return response
