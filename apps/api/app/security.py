"""Password hashing and opaque session tokens shared by auth dependencies."""

import hashlib

from pwdlib import PasswordHash

COOKIE_NAME = "recall_session"
SESSION_SECONDS = 7 * 24 * 60 * 60
passwords = PasswordHash.recommended()


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
