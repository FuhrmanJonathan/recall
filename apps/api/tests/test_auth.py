import hashlib
import time
from http.cookies import SimpleCookie

import pytest
from fastapi.testclient import TestClient
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import generate, main
from app.deps import get_session
from app.flashcards import CardDraft
from recall_db.database import create_database_engine, create_tables
from recall_db.models import AuthSession, Deck, User


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

    async def fake_cards(text, *, from_ocr=False):
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
