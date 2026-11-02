"""Database-backed account creation and cookie sessions."""

import secrets
import time
import logging

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from resend.exceptions import ResendError
from pwdlib.exceptions import UnknownHashError
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.deps import get_current_user, get_session
from app.email_service import send_password_reset_email
from app.security import COOKIE_NAME, SESSION_SECONDS, passwords, token_digest
from recall_db.models import AuthSession, PasswordResetToken, User

router = APIRouter(prefix="/api/auth", tags=["auth"])
_DUMMY_HASH = passwords.hash(secrets.token_urlsafe(32))
_logger = logging.getLogger(__name__)
_PASSWORD_RESET_SECONDS = 30 * 60


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordReset(BaseModel):
    token: str
    password: str = Field(min_length=5)


class Credentials(BaseModel):
    email: EmailStr
    password: str


class SignupCredentials(Credentials):
    password: str = Field(min_length=5)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str


def _create_session(session: Session, user: User, previous_token: str | None) -> str:
    if previous_token:
        session.execute(
            delete(AuthSession).where(AuthSession.token_hash == token_digest(previous_token))
        )
    token = secrets.token_urlsafe(32)
    session.add(AuthSession(
        token_hash=token_digest(token),
        user_id=user.id,
        expires_at=int(time.time()) + SESSION_SECONDS,
    ))
    return token


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_SECONDS,
        path="/api",
        httponly=True,
        secure=config.SESSION_COOKIE_SECURE,
        samesite="lax",
    )


@router.post("/signup", status_code=201, response_model=UserOut)
def signup(
    data: SignupCredentials,
    response: Response,
    session: Session = Depends(get_session),
    previous_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> User:
    email = data.email.lower()
    if session.scalar(select(User).where(User.email == email)) is not None:
        raise HTTPException(409, "An account with this email already exists.")

    user = User(email=email, password_hash=passwords.hash(data.password))
    session.add(user)
    try:
        session.flush()
        token = _create_session(session, user, previous_token)
        session.commit()
    except IntegrityError:
        session.rollback()
        # The unique constraint also handles two signups arriving together.
        if session.scalar(select(User).where(User.email == email)) is not None:
            raise HTTPException(409, "An account with this email already exists.") from None
        raise
    _set_cookie(response, token)
    return user


@router.post("/login", response_model=UserOut)
def login(
    data: Credentials,
    response: Response,
    session: Session = Depends(get_session),
    previous_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> User:
    if not data.password:
        raise HTTPException(400, "Password is required.")
    user = session.scalar(select(User).where(User.email == data.email.lower()))
    try:
        valid = passwords.verify(data.password, user.password_hash if user else _DUMMY_HASH)
    except UnknownHashError:
        # Demonstration accounts use a placeholder hash and cannot log in.
        valid = False
    if user is None or not valid:
        raise HTTPException(401, "Incorrect email or password.")

    token = _create_session(session, user, previous_token)
    session.commit()
    _set_cookie(response, token)
    return user


@router.post("/logout")
def logout(
    response: Response,
    session: Session = Depends(get_session),
    token: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> dict[str, str]:
    if token:
        session.execute(delete(AuthSession).where(AuthSession.token_hash == token_digest(token)))
        session.commit()
    response.delete_cookie(
        COOKIE_NAME, path="/api", httponly=True,
        secure=config.SESSION_COOKIE_SECURE, samesite="lax",
    )
    return {"message": "Session cookie cleared."}


@router.get("/me", response_model=UserOut)
def current_user(user: User = Depends(get_current_user)) -> User:
    return user


@router.post("/password/forgot")
def forgot_password(data: PasswordResetRequest, session: Session = Depends(get_session)):
    user = session.scalar(select(User).where(User.email == data.email.lower()))
    if user is not None:
        session.execute(
            delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id)
        )
        token = secrets.token_urlsafe(32)
        session.add(PasswordResetToken(
            token_hash=token_digest(token),
            user_id=user.id,
            expires_at=int(time.time()) + _PASSWORD_RESET_SECONDS,
        ))
        session.commit()
        try:
            send_password_reset_email(user.email, token)
        except (ValueError, ResendError) as error:
            _logger.error("Could not send password reset email: %s", error)
            session.execute(
                delete(PasswordResetToken).where(
                    PasswordResetToken.token_hash == token_digest(token)
                )
            )
            session.commit()
    return {"message": "If that email has an account, a password reset link has been sent."}


@router.post("/password/reset")
def reset_password(data: PasswordReset, session: Session = Depends(get_session)):
    now = int(time.time())
    reset_token = session.scalar(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == token_digest(data.token),
            PasswordResetToken.expires_at > now,
        )
    )
    if reset_token is None:
        raise HTTPException(400, "This password reset link is invalid or has expired.")

    result = session.execute(
        delete(PasswordResetToken).where(
            PasswordResetToken.token_hash == reset_token.token_hash,
            PasswordResetToken.expires_at > now,
        )
    )
    if result.rowcount != 1:
        session.rollback()
        raise HTTPException(400, "This password reset link is invalid or has expired.")

    user = session.get(User, reset_token.user_id)
    if user is None:
        session.rollback()
        raise HTTPException(400, "This password reset link is invalid or has expired.")
    user.password_hash = passwords.hash(data.password)
    session.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    session.execute(
        delete(PasswordResetToken).where(PasswordResetToken.user_id == user.id)
    )
    session.commit()
    return {"message": "Password reset successfully. Please log in."}


@router.post("/password/change")
def change_password(data: dict):
    raise HTTPException(501, "Not implemented yet.")
