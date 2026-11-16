"""Database-backed account creation and cookie sessions."""

import secrets
import time
import logging
from functools import partial

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from google.auth.exceptions import GoogleAuthError, TransportError
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2 import id_token
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
from recall_db.models import AuthSession, GoogleIdentity, GoogleLoginChallenge, PasswordResetToken, User

router = APIRouter(prefix="/api/auth", tags=["auth"])
_DUMMY_HASH = passwords.hash(secrets.token_urlsafe(32))
_logger = logging.getLogger(__name__)
_PASSWORD_RESET_SECONDS = 30 * 60
_GOOGLE_COOKIE = "recall_google_nonce"
_GOOGLE_PATH = "/api/auth/google"
_GOOGLE_CHALLENGE_SECONDS = 10 * 60


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


class GoogleCredentials(BaseModel):
    credential: str = Field(min_length=1, max_length=16_384)
    password: str | None = None


class GoogleClaims(BaseModel):
    sub: str = Field(min_length=1, max_length=255)
    email: EmailStr
    nonce: str
    email_verified: bool = Field(strict=True)


@router.get("/google/challenge")
def google_challenge(
    response: Response,
    session: Session = Depends(get_session),
    previous_nonce: str | None = Cookie(default=None, alias=_GOOGLE_COOKIE),
):
    response.headers["Cache-Control"] = "no-store"
    if not config.GOOGLE_CLIENT_ID:
        return {"client_id": None, "nonce": None}

    now = int(time.time())
    session.execute(delete(GoogleLoginChallenge).where(GoogleLoginChallenge.expires_at <= now))
    # Reuse a fresh challenge on remounts and across login/signup tabs.
    previous = session.get(GoogleLoginChallenge, token_digest(previous_nonce)) if previous_nonce else None
    if previous is not None and previous.expires_at > now + 60:
        session.commit()
        return {"client_id": config.GOOGLE_CLIENT_ID, "nonce": previous_nonce}
    if previous is not None:
        session.delete(previous)
    nonce = secrets.token_urlsafe(32)
    session.add(GoogleLoginChallenge(
        nonce_hash=token_digest(nonce), expires_at=now + _GOOGLE_CHALLENGE_SECONDS,
    ))
    session.commit()
    response.set_cookie(
        _GOOGLE_COOKIE, nonce, max_age=_GOOGLE_CHALLENGE_SECONDS,
        path=_GOOGLE_PATH, httponly=True, secure=config.SESSION_COOKIE_SECURE,
        samesite="strict",
    )
    return {"client_id": config.GOOGLE_CLIENT_ID, "nonce": nonce}


@router.post("/google", response_model=UserOut)
def google_login(
    data: GoogleCredentials,
    response: Response,
    session: Session = Depends(get_session),
    nonce: str | None = Cookie(default=None, alias=_GOOGLE_COOKIE),
    previous_token: str | None = Cookie(default=None, alias=COOKIE_NAME),
) -> User:
    if not config.GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Google sign-in is not configured.")
    challenge = session.get(GoogleLoginChallenge, token_digest(nonce)) if nonce else None
    if challenge is None or challenge.expires_at <= int(time.time()):
        raise HTTPException(403, "Google sign-in expired. Please try Google again.")
    try:
        claims = GoogleClaims.model_validate(id_token.verify_oauth2_token(
            data.credential, partial(GoogleRequest(), timeout=10), config.GOOGLE_CLIENT_ID,
        ))
    except TransportError:
        raise HTTPException(503, "Google sign-in is temporarily unavailable. Please try again.") from None
    except (ValueError, GoogleAuthError, KeyError):
        raise HTTPException(401, "Could not verify your Google account. Please try Google again.") from None
    if not claims.email_verified:
        raise HTTPException(401, "Google must verify your email before you can sign in.")
    if not secrets.compare_digest(claims.nonce.encode(), nonce.encode()):
        raise HTTPException(403, "Google sign-in did not match this browser. Please try Google again.")

    identity = session.get(GoogleIdentity, claims.sub)
    if identity is not None:
        # Google emails may change; the stable subject determines ownership.
        user = session.get(User, identity.user_id)
    else:
        user = session.scalar(select(User).where(User.email == claims.email.lower()))
        if user is not None:
            if session.scalar(select(GoogleIdentity).where(GoogleIdentity.user_id == user.id)):
                raise HTTPException(409, "This Recall account is linked to another Google account.")
            if data.password is None:
                raise HTTPException(409, detail={
                    "code": "link_required", "email": user.email,
                    "message": "Enter your Recall password to link this Google account.",
                })
            try:
                valid = passwords.verify(data.password, user.password_hash)
            except UnknownHashError:
                valid = False
            if not valid:
                raise HTTPException(401, "Incorrect Recall password.")
        else:
            # Keep the existing NOT NULL column. Password reset can establish a
            # password later; this random password is never retained or exposed.
            user = User(email=claims.email.lower(), password_hash=passwords.hash(secrets.token_urlsafe(32)))
            session.add(user)

    try:
        # Consume once, in the same transaction as the identity and session.
        consumed = session.execute(delete(GoogleLoginChallenge).where(
            GoogleLoginChallenge.nonce_hash == challenge.nonce_hash,
            GoogleLoginChallenge.expires_at > int(time.time()),
        ))
        if consumed.rowcount != 1:
            session.rollback()
            raise HTTPException(403, "Google sign-in expired. Please try Google again.")
        session.flush()
        if identity is None:
            session.add(GoogleIdentity(subject=claims.sub, user_id=user.id))
        token = _create_session(session, user, previous_token)
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "Your account changed during sign-in. Please try Google again.") from None
    _set_cookie(response, token)
    response.delete_cookie(
        _GOOGLE_COOKIE, path=_GOOGLE_PATH, httponly=True,
        secure=config.SESSION_COOKIE_SECURE, samesite="strict",
    )
    response.headers["Cache-Control"] = "no-store"
    return user


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
