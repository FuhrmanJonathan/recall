from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, LargeBinary, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from recall_db.database import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))

    decks: Mapped[list["Deck"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )
    sessions: Mapped[list["AuthSession"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class AuthSession(TimestampMixin, Base):
    __tablename__ = "auth_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    expires_at: Mapped[int] = mapped_column(index=True)

    user: Mapped[User] = relationship(back_populates="sessions")


class Deck(TimestampMixin, Base):
    __tablename__ = "decks"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))

    owner: Mapped[User] = relationship(back_populates="decks")
    flashcards: Mapped[list["Flashcard"]] = relationship(
        back_populates="deck", cascade="all, delete-orphan")


class Flashcard(TimestampMixin, Base):
    __tablename__ = "flashcards"

    id: Mapped[int] = mapped_column(primary_key=True)
    deck_id: Mapped[int] = mapped_column(
        ForeignKey("decks.id", ondelete="CASCADE"), index=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)

    deck: Mapped[Deck] = relationship(back_populates="flashcards")

class Review(TimestampMixin, Base):
    __tablename__ = "reviews"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    flashcard_id: Mapped[int] = mapped_column(
        ForeignKey("flashcards.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True)
    rating: Mapped[str] = mapped_column(String(10))  # Again/Hard/Good/Easy


class CardReviewState(Base):
    """Current scheduling state, separate from the append-only review history."""

    __tablename__ = "card_review_states"
    __table_args__ = (
        CheckConstraint("repetitions >= 0"),
        CheckConstraint("interval_days >= 0"),
        CheckConstraint("ease_factor >= 1.3"),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    flashcard_id: Mapped[int] = mapped_column(
        ForeignKey("flashcards.id", ondelete="CASCADE"), primary_key=True
    )
    repetitions: Mapped[int] = mapped_column(default=0)
    interval_days: Mapped[int] = mapped_column(default=0)
    ease_factor: Mapped[float] = mapped_column(Float, default=2.5)
    last_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    version: Mapped[int] = mapped_column(default=1)

    # Reject concurrent updates based on the same old state.
    __mapper_args__ = {"version_id_col": version}


class NoteUpload(TimestampMixin, Base):
    """Original notes saved without invoking OCR or flashcard generation."""

    __tablename__ = "note_uploads"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(200))
    filename: Mapped[str] = mapped_column(String(255))
    data: Mapped[bytes] = mapped_column(LargeBinary)
