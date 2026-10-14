"""SM-2-based spaced repetition algorithm

Reference: https://super-memory.org/archive/english/ol/sm2.htm
SM-2 is used because it is easier to implement and allow us to add more features in later development easier
(such as review based on exam schedule or chapters)
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import ceil, isfinite


RATING_QUALITY = {"again": 2, "hard": 3, "good": 4, "easy": 5}


def _utc(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Review times must be timezone-aware datetimes.")
    return value.astimezone(timezone.utc)


@dataclass(frozen=True)
class ReviewState:
    """Persist these fields separately for each learner and flashcard."""

    repetitions: int = 0
    interval_days: int = 0
    ease_factor: float = 2.5
    last_reviewed_at: datetime | None = None
    due_at: datetime | None = None

    def __post_init__(self) -> None:
        for value in (self.repetitions, self.interval_days):
            if type(value) is not int or value < 0:
                raise ValueError("Repetitions and interval must be nonnegative integers.")
        if (isinstance(self.ease_factor, bool)
                or not isinstance(self.ease_factor, (int, float))
                or not isfinite(self.ease_factor) or self.ease_factor < 1.3):
            raise ValueError("Ease factor must be finite and at least 1.3.")
        if self.repetitions > 0 and self.interval_days == 0:
            raise ValueError("Reviewed cards need a positive interval.")
        for value in (self.last_reviewed_at, self.due_at):
            if value is not None:
                _utc(value)


@dataclass(frozen=True)
class ReviewResult:
    state: ReviewState
    quality: int
    reviewed_at: datetime


def review_card(state: ReviewState,quality: int,*,reviewed_at: datetime,) -> ReviewResult:
    """Return a new state; the caller saves the state and the review event atomically.
    """
    if type(quality) is not int or not 0 <= quality <= 5:
        raise ValueError("Quality must be an integer from 0 to 5.")
    now = _utc(reviewed_at)
    if state.last_reviewed_at is not None and now <= _utc(state.last_reviewed_at):
        raise ValueError("Review time must be later than the previous review.")

    if quality < 3:
        repetitions, interval = 0, 1
    else:
        repetitions = state.repetitions + 1
        if repetitions == 1:
            interval = 1
        elif repetitions == 2:
            interval = 6
        else:
            interval = ceil(state.interval_days * state.ease_factor)

    ease = max(1.3, round(
        state.ease_factor + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02), 10))
    try:
        due = now + timedelta(days=interval)
    except OverflowError as exc:
        raise ValueError("Calculated interval exceeds the supported date range.") from exc
    return ReviewResult(
        state=ReviewState(repetitions, interval, ease, now, due),
        quality=quality,
        reviewed_at=now,
    )


def review_rating(state: ReviewState, rating: str, *, reviewed_at: datetime) -> ReviewResult:
    """Map Recall's four UI labels to SM-2 quality scores."""
    if not isinstance(rating, str) or rating.lower() not in RATING_QUALITY:
        raise ValueError("Rating must be again, hard, good, or easy.")
    return review_card(state, RATING_QUALITY[rating.lower()], reviewed_at=reviewed_at)
