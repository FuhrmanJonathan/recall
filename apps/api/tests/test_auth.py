import hashlib
import json
import time
from http.cookies import SimpleCookie
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from google.auth import crypt, jwt
from google.auth.exceptions import TransportError
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import auth, config, generate, main
from app.deps import get_session
from app.flashcards import CardDraft
from recall_db.database import create_database_engine, create_tables
from recall_db.models import AuthSession, Deck, GoogleIdentity, GoogleLoginChallenge, PasswordResetToken, User


CREDENTIALS = {"email": "student@example.com", "password": "study-password"}
COOKIE_NAME = "recall_session"
SESSION_SECONDS = 7 * 24 * 60 * 60


@pytest.fixture()
def engine(tmp_path):
    engine = create_database_engine(f"sqlite:///{tmp_path / 'auth.db'}")
    create_tables(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def client(engine, monkeypatch):
    def override_session():
        with Session(engine) as session:
            yield session

    main.app.dependency_overrides[get_session] = override_session
    monkeypatch.setattr(main, "create_tables", lambda: create_tables(engine))
    try:
        with TestClient(main.app) as client:
            yield client
    finally:
        main.app.dependency_overrides.clear()


def signup(client, credentials=None):
    response = client.post("/api/auth/signup", json=credentials or CREDENTIALS)
    assert response.status_code == 201, response.text
    return response


def cookie_header(token):
    return {"cookie": f"{COOKIE_NAME}={token}"}


def test_signup_saves_hashed_password_and_session(client, engine):
    before = int(time.time())
    response = signup(client, {**CREDENTIALS, "email": "Student@Example.COM"})
    body = response.json()
    token = response.cookies[COOKIE_NAME]
    token_hash = hashlib.sha256(token.encode()).hexdigest()

    assert body == {"id": body["id"], "email": "student@example.com"}
    assert isinstance(body["id"], int)
    assert CREDENTIALS["password"] not in response.text
    assert token not in response.text
    cookie = SimpleCookie(response.headers["set-cookie"])[COOKIE_NAME]
    assert cookie["httponly"]
    assert cookie["samesite"].lower() == "lax"
    assert cookie["path"] == "/api"
    assert int(cookie["max-age"]) == SESSION_SECONDS

    with Session(engine) as session:
        user = session.get(User, body["id"])
        assert user.email == "student@example.com"
        assert user.password_hash != CREDENTIALS["password"]
        assert PasswordHash.recommended().verify(CREDENTIALS["password"], user.password_hash)
        saved_session = session.get(AuthSession, token_hash)
        assert saved_session is not None
        assert session.get(AuthSession, token) is None
        assert saved_session.user_id == user.id
        assert before + SESSION_SECONDS <= saved_session.expires_at <= int(time.time()) + SESSION_SECONDS

    assert client.get("/api/auth/me").json() == body


def test_duplicate_email_is_case_insensitive(client, engine):
    original = signup(client).json()
    response = client.post(
        "/api/auth/signup",
        json={"email": "STUDENT@EXAMPLE.COM", "password": "different-password"},
    )
    assert response.status_code == 409
    assert "set-cookie" not in response.headers
    assert client.get("/api/auth/me").json() == original
    with Session(engine) as session:
        assert len(session.scalars(select(User)).all()) == 1
        assert len(session.scalars(select(AuthSession)).all()) == 1


@pytest.mark.parametrize("route", ["signup", "login"])
@pytest.mark.parametrize("data", [
    {"email": "not-an-email", "password": "study-password"},
    {"password": "study-password"},
    {"email": "student@example.com"},
    {"email": "student@example.com", "password": 123},
])
def test_invalid_credentials(client, engine, route, data):
    response = client.post(f"/api/auth/{route}", json=data)
    assert response.status_code == 422
    assert "set-cookie" not in response.headers
    with Session(engine) as session:
        assert session.scalars(select(User)).all() == []
        assert session.scalars(select(AuthSession)).all() == []


@pytest.mark.parametrize("password", ["", "1234"])
def test_signup_rejects_short_password(client, password):
    response = client.post("/api/auth/signup", json={**CREDENTIALS, "password": password})
    assert response.status_code == 422
    assert "set-cookie" not in response.headers


def test_login_rejects_empty_password(client):
    response = client.post("/api/auth/login", json={**CREDENTIALS, "password": ""})
    assert response.status_code == 400
    assert "set-cookie" not in response.headers


def test_login_restores_session_from_saved_user(client, engine):
    user = signup(client).json()
    assert client.post("/api/auth/logout").status_code == 200
    response = client.post("/api/auth/login", json={**CREDENTIALS, "email": "STUDENT@EXAMPLE.COM"})
    assert response.status_code == 200
    assert response.json() == user
    assert client.get("/api/auth/me").json() == user
    token = response.cookies[COOKIE_NAME]
    with Session(engine) as session:
        saved_session = session.get(AuthSession, hashlib.sha256(token.encode()).hexdigest())
        assert saved_session.user_id == user["id"]


def test_password_reset_email_is_generic_and_resets_password(client, engine, monkeypatch):
    signup(client)
    sent = []
    monkeypatch.setattr(
        "app.auth.send_password_reset_email",
        lambda email, token: sent.append((email, token)),
    )

    response = client.post(
        "/api/auth/password/forgot", json={"email": "STUDENT@example.com"}
    )

    assert response.status_code == 200
    assert response.json() == {
        "message": "If that email has an account, a password reset link has been sent."
    }
    assert len(sent) == 1
    email, token = sent[0]
    assert email == "student@example.com"
    with Session(engine) as session:
        reset = session.get(PasswordResetToken, hashlib.sha256(token.encode()).hexdigest())
        assert reset is not None
        assert reset.expires_at > int(time.time())

    response = client.post(
        "/api/auth/password/reset",
        json={"token": token, "password": "new-password"},
    )
    assert response.status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert client.post(
        "/api/auth/login",
        json={"email": "student@example.com", "password": "new-password"},
    ).status_code == 200
    assert client.post(
        "/api/auth/password/reset",
        json={"token": token, "password": "another-password"},
    ).status_code == 400
    with Session(engine) as session:
        assert session.scalars(select(PasswordResetToken)).all() == []


def test_password_reset_request_does_not_disclose_unknown_email(client, monkeypatch):
    monkeypatch.setattr(
        "app.auth.send_password_reset_email",
        lambda email, token: pytest.fail("No email should be sent for unknown addresses"),
    )
    response = client.post(
        "/api/auth/password/forgot", json={"email": "unknown@example.com"}
    )
    assert response.status_code == 200
    assert response.json() == {
        "message": "If that email has an account, a password reset link has been sent."
    }


def test_password_reset_rejects_expired_token(client, engine):
    with Session(engine) as session:
        user = User(email="student@example.com", password_hash="old-hash")
        session.add(user)
        session.flush()
        token = "expired-reset-token"
        session.add(PasswordResetToken(
            token_hash=hashlib.sha256(token.encode()).hexdigest(),
            user_id=user.id,
            expires_at=int(time.time()) - 1,
        ))
        session.commit()

    response = client.post(
        "/api/auth/password/reset",
        json={"token": token, "password": "new-password"},
    )
    assert response.status_code == 400
    with Session(engine) as session:
        assert session.get(User, 1).password_hash == "old-hash"


@pytest.mark.parametrize("credentials", [
    {**CREDENTIALS, "password": "incorrect-password"},
    {**CREDENTIALS, "email": "unknown@example.com"},
])
def test_bad_login_does_not_create_session(client, engine, credentials):
    signup(client)
    client.post("/api/auth/logout")
    response = client.post("/api/auth/login", json=credentials)
    assert response.status_code == 401
    assert "set-cookie" not in response.headers
    assert client.get("/api/auth/me").status_code == 401
    with Session(engine) as session:
        assert session.scalars(select(AuthSession)).all() == []


def test_placeholder_password_hash_is_rejected_without_server_error(client, engine):
    with Session(engine) as session:
        session.add(User(email="seed@example.com", password_hash="placeholder"))
        session.commit()
    response = client.post(
        "/api/auth/login", json={"email": "seed@example.com", "password": "placeholder"}
    )
    assert response.status_code == 401
    assert "set-cookie" not in response.headers


@pytest.mark.parametrize("token", [None, "unknown-session-token"])
def test_me_requires_valid_session(client, token):
    headers = cookie_header(token) if token else {}
    response = client.get("/api/auth/me", headers=headers)
    assert response.status_code == 401


def test_expired_session_is_rejected(client, engine):
    token = signup(client).cookies[COOKIE_NAME]
    with Session(engine) as session:
        saved_session = session.get(AuthSession, hashlib.sha256(token.encode()).hexdigest())
        saved_session.expires_at = int(time.time()) - 1
        session.commit()
    assert client.get("/api/auth/me").status_code == 401


def test_logout_revokes_cookie_and_prevents_replay(client, engine):
    token = signup(client).cookies[COOKIE_NAME]
    response = client.post("/api/auth/logout")
    assert response.status_code == 200
    assert response.json() == {"message": "Session cookie cleared."}
    cookie = SimpleCookie(response.headers["set-cookie"])[COOKIE_NAME]
    assert cookie.value == ""
    assert cookie["max-age"] == "0"
    assert cookie["path"] == "/api"
    assert COOKIE_NAME not in client.cookies
    with Session(engine) as session:
        assert session.get(AuthSession, hashlib.sha256(token.encode()).hexdigest()) is None
    assert client.get("/api/auth/me", headers=cookie_header(token)).status_code == 401


def test_logout_without_session_is_idempotent(client):
    assert client.post("/api/auth/logout").status_code == 200
    assert client.post("/api/auth/logout").status_code == 200


def test_user_and_login_survive_new_client_and_database_engine(client, engine, monkeypatch):
    response = signup(client)
    user = response.json()
    token = response.cookies[COOKIE_NAME]
    engine.dispose()
    reopened_engine = create_database_engine(str(engine.url))

    def reopened_session():
        with Session(reopened_engine) as session:
            yield session

    main.app.dependency_overrides[get_session] = reopened_session
    monkeypatch.setattr(main, "create_tables", lambda: create_tables(reopened_engine))
    try:
        with TestClient(main.app) as new_client:
            assert new_client.get("/api/auth/me").status_code == 401
            assert new_client.get("/api/auth/me", headers=cookie_header(token)).json() == user
            login_response = new_client.post("/api/auth/login", json=CREDENTIALS)
            assert login_response.status_code == 200
            assert login_response.json() == user
            assert new_client.get("/api/auth/me").json() == user
    finally:
        reopened_engine.dispose()


def test_generated_deck_is_private_to_signed_in_owner(client, engine, monkeypatch):
    owner = signup(client).json()

    async def fake_cards(text, *, from_ocr=False, focus=None, tag_mode=None):
        return [CardDraft(question="What is mitosis?", answer="Cell division.")]

    monkeypatch.setattr(generate, "generate_cards_from_text", fake_cards)
    response = client.post(
        "/api/flashcards/generate",
        files={"file": ("biology.txt", b"Mitosis is cell division.", "text/plain")},
    )
    assert response.status_code == 201
    deck_id = response.json()["id"]
    assert client.get(f"/api/decks/{deck_id}").status_code == 200
    with Session(engine) as session:
        assert session.get(Deck, deck_id).user_id == owner["id"]

    client.post("/api/auth/logout")
    signup(client, {"email": "other@example.com", "password": "other-password"})
    assert client.get(f"/api/decks/{deck_id}").status_code == 404
    client.post("/api/auth/logout")
    assert client.get(f"/api/decks/{deck_id}").status_code == 401


def test_unauthenticated_generation_never_calls_generator(client, engine, monkeypatch):
    async def unexpected_generation(*args, **kwargs):
        pytest.fail("Unauthenticated requests must not generate flashcards")

    monkeypatch.setattr(generate, "generate_cards_from_text", unexpected_generation)
    response = client.post(
        "/api/flashcards/generate",
        files={"file": ("biology.txt", b"Mitosis is cell division.", "text/plain")},
    )
    assert response.status_code == 401
    with Session(engine) as session:
        assert session.scalars(select(User)).all() == []
        assert session.scalars(select(Deck)).all() == []


@pytest.fixture(scope="module")
def google_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture()
def google_token(client, monkeypatch, google_key):
    """Exercise real JWT verification; only Google's certificate HTTP call is faked."""
    monkeypatch.setattr(config, "GOOGLE_CLIENT_ID", "recall-test.apps.googleusercontent.com")
    public_key = google_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode()

    def certificate_request(url, method, timeout):
        assert url == "https://www.googleapis.com/oauth2/v1/certs"
        assert method == "GET"
        assert timeout == 10
        return SimpleNamespace(status=200, data=json.dumps({"test-key": public_key}).encode())

    monkeypatch.setattr(auth, "GoogleRequest", lambda: certificate_request)
    signer = crypt.RSASigner(google_key, key_id="test-key")

    def make_token(**overrides):
        nonce = client.get("/api/auth/google/challenge").json()["nonce"]
        payload = {
            "iss": "https://accounts.google.com", "aud": config.GOOGLE_CLIENT_ID,
            "sub": "google-user-123", "email": "Student@example.com", "email_verified": True,
            "nonce": nonce, "iat": int(time.time()), "exp": int(time.time()) + 3600,
        }
        payload.update(overrides)
        return jwt.encode(signer, payload).decode()

    return make_token


def test_google_disabled_without_configuration(client, monkeypatch):
    monkeypatch.setattr(config, "GOOGLE_CLIENT_ID", "")
    response = client.get("/api/auth/google/challenge")
    assert response.json() == {"client_id": None, "nonce": None}
    assert response.headers["cache-control"] == "no-store"
    assert "set-cookie" not in response.headers
    assert client.post("/api/auth/google", json={"credential": "token"}).status_code == 503


def test_google_challenge_cookie_and_reuse(client, engine, google_token, monkeypatch):
    monkeypatch.setattr(config, "SESSION_COOKIE_SECURE", True)
    response = client.get("/api/auth/google/challenge")
    nonce = response.json()["nonce"]
    cookie = SimpleCookie(response.headers["set-cookie"])["recall_google_nonce"]
    assert cookie["httponly"] and cookie["secure"]
    assert cookie["samesite"].lower() == "strict"
    assert cookie["path"] == "/api/auth/google"
    assert int(cookie["max-age"]) == 600
    assert response.headers["cache-control"] == "no-store"
    # TestClient is HTTP, so explicitly send the Secure cookie for this check.
    again = client.get("/api/auth/google/challenge", headers={"cookie": f"recall_google_nonce={nonce}"})
    assert again.json() == response.json()
    with Session(engine) as session:
        assert len(session.scalars(select(GoogleLoginChallenge)).all()) == 1
        assert session.get(GoogleLoginChallenge, nonce) is None


def test_google_signup_and_returning_subject_preserve_account(client, engine, google_token):
    credential = google_token()
    nonce = client.cookies["recall_google_nonce"]
    response = client.post("/api/auth/google", json={"credential": credential})
    assert response.status_code == 200, response.text
    user = response.json()
    assert user == {"id": user["id"], "email": "student@example.com"}
    assert client.get("/api/auth/me").json() == user
    assert "recall_google_nonce" not in client.cookies
    with Session(engine) as session:
        assert session.get(GoogleIdentity, "google-user-123").user_id == user["id"]
        assert session.get(User, user["id"]).password_hash.startswith("$argon2")
        assert session.scalars(select(GoogleLoginChallenge)).all() == []

    # Even replaying the consumed nonce cookie cannot issue another session.
    replay = client.post("/api/auth/google", json={"credential": credential}, headers={
        "cookie": f"recall_google_nonce={nonce}",
    })
    assert replay.status_code == 403
    original_session = response.cookies[COOKIE_NAME]
    # A changed email must still resolve to the original subject's user.
    response = client.post("/api/auth/google", json={"credential": google_token(email="changed@example.com")})
    assert response.status_code == 200
    assert response.json() == user
    with Session(engine) as session:
        assert len(session.scalars(select(User)).all()) == 1
        assert session.get(AuthSession, hashlib.sha256(original_session.encode()).hexdigest()) is None
    token = response.cookies[COOKIE_NAME]
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me", headers=cookie_header(token)).status_code == 401


def test_google_link_requires_password_and_preserves_decks(client, engine, google_token):
    original = signup(client).json()
    with Session(engine) as session:
        deck = Deck(user_id=original["id"], title="Keep my deck")
        session.add(deck)
        session.commit()
        deck_id = deck.id
    client.post("/api/auth/logout")
    credential = google_token()
    response = client.post("/api/auth/google", json={"credential": credential})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "link_required"
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/google", json={
        "credential": credential, "password": "wrong",
    }).status_code == 401
    with Session(engine) as session:
        assert session.scalars(select(GoogleIdentity)).all() == []
        assert session.scalars(select(AuthSession)).all() == []
    response = client.post("/api/auth/google", json={
        "credential": credential, "password": CREDENTIALS["password"],
    })
    assert response.status_code == 200
    assert response.json() == original
    assert client.get(f"/api/decks/{deck_id}").status_code == 200
    client.post("/api/auth/logout")
    assert client.post("/api/auth/login", json=CREDENTIALS).status_code == 200
    # A different Google subject cannot replace an existing link, even with a password.
    response = client.post("/api/auth/google", json={
        "credential": google_token(sub="different-google-account"), "password": CREDENTIALS["password"],
    })
    assert response.status_code == 409


@pytest.mark.parametrize("overrides, status", [
    ({"aud": "another-app"}, 401),
    ({"iss": "https://attacker.example"}, 401),
    ({"exp": int(time.time()) - 1}, 401),
    ({"email_verified": False}, 401),
    ({"email_verified": "true"}, 401),
    ({"email": "not-an-email"}, 401),
    ({"sub": ""}, 401),
    ({"nonce": "another-browser"}, 403),
])
def test_google_rejects_invalid_claims(client, engine, google_token, overrides, status):
    response = client.post("/api/auth/google", json={"credential": google_token(**overrides)})
    assert response.status_code == status
    assert "set-cookie" not in response.headers
    with Session(engine) as session:
        assert session.scalars(select(User)).all() == []
        assert session.scalars(select(AuthSession)).all() == []
        assert session.scalars(select(GoogleIdentity)).all() == []


def test_google_rejects_forged_signature(client, google_token):
    original = google_token()
    claims = jwt.decode(original, verify=False)
    attacker_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged = jwt.encode(crypt.RSASigner(attacker_key, key_id="test-key"), claims).decode()
    assert client.post("/api/auth/google", json={"credential": forged}).status_code == 401


@pytest.mark.parametrize("cookie", [None, "attacker-cookie"])
def test_google_requires_browser_challenge(client, google_token, cookie):
    credential = google_token()
    client.cookies.clear()
    headers = {"cookie": f"recall_google_nonce={cookie}"} if cookie else {}
    response = client.post("/api/auth/google", json={"credential": credential}, headers=headers)
    assert response.status_code == 403


def test_google_rejects_expired_challenge_and_cleans_it_up(client, engine, google_token):
    credential = google_token()
    nonce = client.cookies["recall_google_nonce"]
    with Session(engine) as session:
        session.get(GoogleLoginChallenge, hashlib.sha256(nonce.encode()).hexdigest()).expires_at = 0
        session.commit()
    assert client.post("/api/auth/google", json={"credential": credential}).status_code == 403
    fresh = client.get("/api/auth/google/challenge").json()["nonce"]
    assert fresh != nonce
    with Session(engine) as session:
        assert len(session.scalars(select(GoogleLoginChallenge)).all()) == 1


def test_google_certificate_outage_does_not_create_account(client, engine, google_token, monkeypatch):
    credential = google_token()

    def unavailable(*args, **kwargs):
        raise TransportError("unavailable")

    monkeypatch.setattr(auth, "GoogleRequest", lambda: unavailable)
    assert client.post("/api/auth/google", json={"credential": credential}).status_code == 503
    with Session(engine) as session:
        assert session.scalars(select(User)).all() == []


def test_google_only_user_can_set_password_via_reset(client, google_token, monkeypatch):
    user = client.post("/api/auth/google", json={"credential": google_token()}).json()
    sent = []
    monkeypatch.setattr(auth, "send_password_reset_email", lambda email, token: sent.append(token))
    client.post("/api/auth/password/forgot", json={"email": user["email"]})
    response = client.post("/api/auth/password/reset", json={"token": sent[0], "password": "my-new-password"})
    assert response.status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": user["email"], "password": "my-new-password"}).status_code == 200
