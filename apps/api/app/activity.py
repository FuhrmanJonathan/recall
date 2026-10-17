#Tracks daily Flashcard usage from each user, provides API endpoints to record and retrieve study activity.
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_session
from recall_db.models import StudyActivity, User

router = APIRouter(
    prefix="/api/activity",
    tags=["activity"]
)
class ActivityIn(BaseModel):
    cards_reviewed: int = Field(ge=1, le=1000)


@router.post("")
def record_activity(
    body: ActivityIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Add completed flashcard reviews to the user's daily total."""

    today = datetime.now(timezone.utc).date()

    activity = session.scalar(
        select(StudyActivity).where(
            StudyActivity.user_id == user.id,
            StudyActivity.study_date == today,
        )
    )

    if activity is None:
        activity = StudyActivity(
            user_id=user.id,
            study_date=today,
            cards_reviewed=body.cards_reviewed,
        )
        session.add(activity)
    else:
        activity.cards_reviewed += body.cards_reviewed

    session.commit()

    return {
        "date": str(activity.study_date),
        "cards_reviewed": activity.cards_reviewed,
    }

@router.get("")
def get_activity(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Retrieve daily flashcard review counts for the current user."""

    activities = session.scalars(
        select(StudyActivity)
        .where(StudyActivity.user_id == user.id)
        .order_by(StudyActivity.study_date)
    ).all()

    return [
        {
            "date": str(activity.study_date),
            "cards_reviewed": activity.cards_reviewed,
        }
        for activity in activities
    ]
