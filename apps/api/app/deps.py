
from collections.abc import Iterator

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from recall_db.database import SessionLocal
from recall_db.init_db import SAMPLE_EMAIL
from recall_db.models import User


def get_session() -> Iterator[Session]:
    """One database session per request."""
    with SessionLocal() as session:
        yield session


def get_current_user(session: Session = Depends(get_session)) -> User:
    """Placeholder until login exists: everything belongs to the sample user from init_db.

    Replace this with real authentication later; the rest of the code only
    depends on getting a User back.
    """
    user = session.scalar(select(User).where(User.email == SAMPLE_EMAIL))
    if user is None:
        user = User(email=SAMPLE_EMAIL, password_hash="placeholder")
        session.add(user)
        session.commit()
    return user
