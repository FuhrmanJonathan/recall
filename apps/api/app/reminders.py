from datetime import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import Literal

from app.deps import get_current_user, get_session
from recall_db.models import ReminderPreference, User


router = APIRouter(
    prefix="/api/reminders",
    tags=["reminders"]
)
class ReminderSettings(BaseModel):
    reminder_type: Literal["daily", "scheduled", "none"]
    reminder_time: time
    timezone: str = "America/New_York"
    scheduled_days: list[str] = []

    @field_validator("scheduled_days")
    @classmethod
    def validate_days(cls, days: list[str]) -> list[str]:
        valid_days = {
            "mon", "tue", "wed", "thu",
            "fri", "sat", "sun"
        }

        if len(days) != len(set(days)):
            raise ValueError("Duplicate weekdays are not allowed.")

        if any(day not in valid_days for day in days):
            raise ValueError("Invalid weekday.")

        return days

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Invalid timezone.")

        return value

    @model_validator(mode="after")
    def validate_schedule(self):
        if self.reminder_type == "scheduled":
            if not self.scheduled_days:
                raise ValueError(
                    "Scheduled reminders require at least one day."
                )
        elif self.scheduled_days:
            raise ValueError(
                "Only scheduled reminders can specify weekdays."
            )

        return self

@router.put("", response_model=ReminderSettings)

def save_reminders(
    settings: ReminderSettings,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Create or update the current user's reminder preferences."""

    reminder = session.scalar(
        select(ReminderPreference).where(
            ReminderPreference.user_id == user.id
        )
    )

    if reminder is None:
        reminder = ReminderPreference(user_id=user.id)
        session.add(reminder)

    reminder.reminder_type = settings.reminder_type
    reminder.reminder_time = settings.reminder_time
    reminder.timezone = settings.timezone
    reminder.scheduled_days = ",".join(settings.scheduled_days)

    session.commit()

    return settings


@router.get("", response_model=ReminderSettings)
def get_reminders(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    """Retrieve the current user's email reminder preferences."""

    reminder = session.scalar(
        select(ReminderPreference).where(
            ReminderPreference.user_id == user.id
        )
    )

    if reminder is None:
        return ReminderSettings(
            reminder_type="none",
            reminder_time=time(18, 0),
            timezone="America/New_York",
            scheduled_days=[],
        )

    return ReminderSettings(
        reminder_type=reminder.reminder_type,
        reminder_time=reminder.reminder_time,
        timezone=reminder.timezone,
        scheduled_days=(
            reminder.scheduled_days.split(",")
            if reminder.scheduled_days
            else []
        ),
    )
