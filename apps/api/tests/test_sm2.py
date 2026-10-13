from datetime import datetime, timedelta, timezone

import pytest

from app.sm2 import ReviewState, review_card, review_rating


NOW = datetime(2026, 10, 13, 12, tzinfo=timezone.utc)


def test_good_sequence_and_original_state_unchanged():
    original = state = ReviewState()
    when = NOW
    for expected in (1, 6, 15, 38):
        result = review_rating(state, "good", reviewed_at=when)
        assert result.state.interval_days == expected
        assert result.state.ease_factor == 2.5
        assert result.state.due_at == when + timedelta(days=expected)
        state, when = result.state, result.state.due_at
    assert original == ReviewState()


@pytest.mark.parametrize("quality,ease", [(0, 1.7), (1, 1.96), (2, 2.18),
                                          (3, 2.36), (4, 2.5), (5, 2.6)])
def test_quality_scores(quality, ease):
    result = review_card(ReviewState(), quality, reviewed_at=NOW)
    assert result.state.ease_factor == pytest.approx(ease)
    assert result.state.repetitions == (0 if quality < 3 else 1)


def test_failure_restarts_sequence_and_ease_has_floor():
    state = ReviewState(repetitions=5, interval_days=90, ease_factor=1.3)
    state = review_rating(state, "again", reviewed_at=NOW).state
    assert (state.repetitions, state.interval_days, state.ease_factor) == (0, 1, 1.3)
    state = review_rating(state, "good", reviewed_at=state.due_at).state
    assert (state.repetitions, state.interval_days) == (1, 1)
    state = review_rating(state, "good", reviewed_at=state.due_at).state
    assert state.interval_days == 6


def test_overdue_review_uses_actual_time_and_previous_ease():
    state = ReviewState(2, 6, 2.5, NOW - timedelta(days=20), NOW - timedelta(days=14))
    result = review_rating(state, "easy", reviewed_at=NOW)
    assert result.state.interval_days == 15
    assert result.state.ease_factor == 2.6
    assert result.state.due_at == NOW + timedelta(days=15)


def test_restored_state_and_timezone():
    local = NOW.astimezone(timezone(timedelta(hours=-4)))
    state = ReviewState(2, 6, 2.5, NOW - timedelta(days=6), NOW)
    restored = ReviewState(**state.__dict__)
    assert review_card(restored, 4, reviewed_at=local) == review_card(state, 4, reviewed_at=NOW)
    assert review_card(state, 4, reviewed_at=local).state.due_at.tzinfo == timezone.utc


@pytest.mark.parametrize("quality", [-1, 6, 4.5, True, "4", None])
def test_invalid_quality(quality):
    with pytest.raises(ValueError):
        review_card(ReviewState(), quality, reviewed_at=NOW)


@pytest.mark.parametrize("rating", ["skip", "", None, 4])
def test_invalid_rating(rating):
    with pytest.raises(ValueError):
        review_rating(ReviewState(), rating, reviewed_at=NOW)


@pytest.mark.parametrize("changes", [dict(repetitions=-1), dict(interval_days=True),
    dict(ease_factor=float("nan")), dict(ease_factor=1.2), dict(repetitions=1)])
def test_invalid_state(changes):
    with pytest.raises(ValueError):
        ReviewState(**changes)


def test_rejects_naive_and_out_of_order_times():
    with pytest.raises(ValueError):
        review_card(ReviewState(), 4, reviewed_at=NOW.replace(tzinfo=None))
    state = review_card(ReviewState(), 4, reviewed_at=NOW).state
    for when in (NOW, NOW - timedelta(seconds=1)):
        with pytest.raises(ValueError):
            review_card(state, 4, reviewed_at=when)
