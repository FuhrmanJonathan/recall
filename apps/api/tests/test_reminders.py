from datetime import datetime, time, timezone
from types import SimpleNamespace

from app.reminderschedule import should_send_reminder


def settings(reminder_type, days=""):
    return SimpleNamespace(
        reminder_type=reminder_type,
        reminder_time=time(18, 0),
        timezone="America/New_York",
        scheduled_days=days,
    )


def test_daily_before_scheduled_time():
    now = datetime(2026, 10, 26, 20, 0, tzinfo=timezone.utc)
    assert not should_send_reminder(settings("daily"), now)


def test_daily_after_scheduled_time():
    now = datetime(2026, 10, 26, 22, 30, tzinfo=timezone.utc)
    assert should_send_reminder(settings("daily"), now)


def test_scheduled_correct_day():
    now = datetime(2026, 10, 26, 22, 30, tzinfo=timezone.utc)
    assert should_send_reminder(settings("scheduled", "mon,wed,fri"), now)


def test_scheduled_wrong_day():
    now = datetime(2026, 10, 27, 22, 30, tzinfo=timezone.utc)
    assert not should_send_reminder(settings("scheduled", "mon,wed,fri"), now)


def test_disabled_reminders():
    now = datetime(2026, 10, 26, 22, 30, tzinfo=timezone.utc)
    assert not should_send_reminder(settings("none"), now)
    