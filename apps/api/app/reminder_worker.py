
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import (
    MetaData, Table, Column, Integer, String,
    UniqueConstraint, select, insert, delete
)
from sqlalchemy.exc import IntegrityError

from recall_db.database import SessionLocal
from recall_db.models import User, ReminderPreference

from app.reminderschedule import should_send_reminder
from app.email_service import send_reminder_email


# Keep track of reminders already sent.
metadata = MetaData()

reminder_log = Table(
    "reminder_email_log",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer, nullable=False),
    Column("local_date", String(10), nullable=False),
    UniqueConstraint("user_id", "local_date"),
)


def check_reminders():
    now = datetime.now(timezone.utc)

    with SessionLocal() as session:
        # Create the log table if it does not exist.
        metadata.create_all(session.get_bind(), checkfirst=True)

        # Find students and their saved reminder settings.
        reminders = session.execute(
            select(ReminderPreference, User.email)
            .join(User, ReminderPreference.user_id == User.id)
        ).all()

        for reminder, email in reminders:

            # Use your existing scheduling logic.
            if not should_send_reminder(reminder, now):
                continue

            local_date = now.astimezone(
                ZoneInfo(reminder.timezone)
            ).date().isoformat()

            # Claim this day's reminder to prevent duplicates.
            try:
                session.execute(
                    insert(reminder_log).values(
                        user_id=reminder.user_id,
                        local_date=local_date,
                    )
                )
                session.commit()

            except IntegrityError:
                session.rollback()
                continue

            # Send email through your existing Resend function.
            try:
                send_reminder_email(email)
                print(f"Reminder sent to {email}")

            except Exception as error:
                print(f"Email failed for {email}: {error}")

                # Allow a later attempt if sending failed.
                session.execute(
                    delete(reminder_log).where(
                        reminder_log.c.user_id == reminder.user_id,
                        reminder_log.c.local_date == local_date,
                    )
                )
                session.commit()


if __name__ == "__main__":
    check_reminders()
