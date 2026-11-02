"""Account-owned daily targets, counted from committed review history."""

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_session
from recall_db.models import DailyStudyGoal, Review, User

router = APIRouter(prefix="/api/goals/daily", tags=["goals"])


def validate_zone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError("Choose a valid time zone.") from None
    return value


class GoalIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: int = Field(strict=True, ge=1, le=1000)
    timezone: str = Field(min_length=1, max_length=100)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        return validate_zone(value)


class GoalOut(BaseModel):
    target: int
    timezone: str
    date: str
    reviewed: int
    next_reset_at: datetime


def _now() -> datetime:
    return datetime.now(timezone.utc)


def progress(session: Session, user: User, target: int, zone_name: str) -> GoalOut:
    zone = ZoneInfo(zone_name)
    now = _now()
    day = now.astimezone(zone).date()
    start = datetime.combine(day, time.min, zone).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(timezone.utc)
    # Half-open local-day bounds also cover 23/25-hour daylight-saving days.
    count = session.scalar(select(func.count(Review.id)).where(
        Review.user_id == user.id, Review.created_at >= start,
        Review.created_at < end, Review.created_at <= now,
    )) or 0
    return GoalOut(target=target, timezone=zone_name, date=str(day),
                   reviewed=count, next_reset_at=end)


@router.get("", response_model=GoalOut)
def get_goal(
    response: Response,
    timezone: str = Query(default="UTC", min_length=1, max_length=100),
    session: Session = Depends(get_session), user: User = Depends(get_current_user),
):
    response.headers["Cache-Control"] = "no-store"
    saved = session.get(DailyStudyGoal, user.id)
    if saved:
        return progress(session, user, saved.target, saved.timezone)
    try:
        validate_zone(timezone)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return progress(session, user, 20, timezone)


@router.put("", response_model=GoalOut)
def save_goal(
    body: GoalIn, response: Response,
    session: Session = Depends(get_session), user: User = Depends(get_current_user),
):
    response.headers["Cache-Control"] = "no-store"
    saved = session.get(DailyStudyGoal, user.id)
    if saved is None:
        saved = DailyStudyGoal(user_id=user.id)
        session.add(saved)
    saved.target, saved.timezone = body.target, body.timezone
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(409, "Your goal changed elsewhere. Reload and try again.") from exc
    return progress(session, user, saved.target, saved.timezone)
