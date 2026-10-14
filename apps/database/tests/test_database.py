import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from recall_db.database import Base, create_database_engine
from recall_db.models import AuthSession, Deck, Flashcard, User


@pytest.fixture()
def session(tmp_path):
    database_path = tmp_path / "test.db"
    engine = create_database_engine(f"sqlite:///{database_path}")
    Base.metadata.create_all(engine)

    with Session(engine) as database_session:
        yield database_session

    engine.dispose()


def test_user_deck_and_flashcard_relationships(session: Session):
    user = User(email="student@example.com", password_hash="hashed-password")
    deck = Deck(title="CS 370", owner=user)
    deck.flashcards.append(
        Flashcard(question="What is Scrum?", answer="An agile framework.")
    )
    session.add(user)
    session.commit()

    stored_deck = session.scalar(select(Deck).where(Deck.title == "CS 370"))

    assert stored_deck is not None
    assert stored_deck.owner.email == "student@example.com"
    assert len(stored_deck.flashcards) == 1
    assert stored_deck.flashcards[0].question == "What is Scrum?"


def test_duplicate_email_is_rejected(session: Session):
    session.add(User(email="student@example.com", password_hash="first"))
    session.commit()
    session.add(User(email="student@example.com", password_hash="second"))

    with pytest.raises(IntegrityError):
        session.commit()


def test_flashcard_requires_an_existing_deck(session: Session):
    session.add(
        Flashcard(deck_id=999, question="Orphan question", answer="Orphan answer")
    )

    with pytest.raises(IntegrityError):
        session.commit()


def test_deleting_user_cascades_to_decks_and_flashcards(session: Session):
    user = User(email="delete@example.com", password_hash="hashed-password")
    deck = Deck(title="Temporary", owner=user)
    deck.flashcards.append(Flashcard(question="Delete me?", answer="Yes."))
    session.add(user)
    session.commit()

    session.delete(user)
    session.commit()

    assert session.scalars(select(Deck)).all() == []
    assert session.scalars(select(Flashcard)).all() == []


def test_auth_session_requires_an_existing_user(session: Session):
    session.add(AuthSession(token_hash="a" * 64, user_id=999, expires_at=2_000_000_000))

    with pytest.raises(IntegrityError):
        session.commit()


def test_deleting_user_cascades_to_auth_sessions(session: Session):
    user = User(email="sessions@example.com", password_hash="hashed-password")
    user.sessions.append(AuthSession(token_hash="a" * 64, expires_at=2_000_000_000))
    session.add(user)
    session.commit()

    stored_session = session.get(AuthSession, "a" * 64)
    assert stored_session is not None
    assert stored_session.user.email == "sessions@example.com"

    session.delete(user)
    session.commit()

    assert session.scalars(select(AuthSession)).all() == []
