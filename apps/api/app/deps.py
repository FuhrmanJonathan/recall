import time
from collections.abc import Iterator

from fastapi import Cookie, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from recall_db.database import SessionLocal
from app.security import COOKIE_NAME, token_digest
from recall_db.models import AuthSession, User


def get_session() -> Iterator[Session]:
    """One database session per request."""
    with SessionLocal() as session:
        yield session


def get_current_user(
    session: Session = Depends(get_session),
    token: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> User:
    """Resolve a user from a persisted, unexpired login session."""
    if not token:
        raise HTTPException(401, "Please log in.")
    user = session.scalar(
        select(User).join(AuthSession).where(
            AuthSession.token_hash == token_digest(token),
            AuthSession.expires_at > int(time.time()),
        )
    )
    if user is None:
        raise HTTPException(401, "Please log in.")
    return user
