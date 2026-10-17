from datetime import datetime
from zoneinfo import ZoneInfo

from recall_db.models import ReminderPreference


WEEKDAYS = [
    "mon", "tue", "wed", "thu",
    "fri", "sat", "sun"
]


def should_send_reminder(
    reminder: ReminderPreference,
    now: datetime,
) -> bool:
    """Check whether a reminder is due at the current time."""

    if reminder.reminder_type == "none":
        return False

    # Convert the current time into the student's timezone
    local_now = now.astimezone(ZoneInfo(reminder.timezone))

    # Don't send before the chosen time
    if local_now.time().replace(
        second=0, microsecond=0
    ) < reminder.reminder_time.replace(
        second=0, microsecond=0
    ):
        return False

    # Check selected days for weekly reminders
    if reminder.reminder_type == "scheduled":
        today = WEEKDAYS[local_now.weekday()]
        selected_days = reminder.scheduled_days.split(",")

        if today not in selected_days:
            return False

    return reminder.reminder_type in ("daily", "scheduled")

