"""Library persistence, ownership, and upload limits."""

from sqlalchemy.orm import Session

from tests.test_auth import client, engine, signup  # noqa: F401
from recall_db.models import Deck, Flashcard


def test_library_requires_login(client):
    assert client.get('/api/decks').status_code == 401
    assert client.get('/api/notes').status_code == 401
    assert client.post('/api/notes', data={'title': 'Notes'}, files={'file': ('notes.txt', b'Notes')}).status_code == 401


def test_upload_persists_and_is_private(client, engine):
    signup(client)
    response = client.post('/api/notes', data={'title': 'Biology'}, files={'file': ('notes.txt', b'Cell notes')})
    assert response.status_code == 201, response.text
    note_id = response.json()['id']
    assert client.get('/api/notes').json()[0]['title'] == 'Biology'
    download = client.get(f'/api/notes/{note_id}/download')
    assert download.content == b'Cell notes'
    assert download.headers['content-disposition'].startswith('attachment;')
    assert client.get('/api/decks').json() == []
    client.post('/api/auth/logout')
    signup(client, {'email': 'other@example.com', 'password': 'study-password'})
    assert client.get('/api/notes').json() == []
    assert client.get(f'/api/notes/{note_id}/download').status_code == 404


def test_deck_list_counts_only_owned_cards(client, engine):
    user = signup(client).json()
    with Session(engine) as session:
        deck = Deck(user_id=user['id'], title='Biology')
        deck.flashcards.append(Flashcard(question='Q', answer='A'))
        session.add(deck)
        session.commit()
    result = client.get('/api/decks').json()
    assert len(result) == 1
    assert result[0]['card_count'] == 1
    assert result[0]['title'] == 'Biology'
    assert client.get(f"/api/decks/{result[0]['id']}").json()['flashcards'][0]['question'] == 'Q'
    client.post('/api/auth/logout')
    signup(client, {'email': 'other@example.com', 'password': 'study-password'})
    assert client.get('/api/decks').json() == []


def test_invalid_uploads_leave_library_empty(client):
    signup(client)
    for title, filename, data, status in [
        ('Notes', 'script.html', b'<script/>', 415),
        ('Notes', 'notes.txt', b'', 400),
        ('   ', 'notes.txt', b'Notes', 400),
        ('Notes', 'notes.txt', b'x' * (5 * 1024 * 1024 + 1), 413),
    ]:
        response = client.post('/api/notes', data={'title': title}, files={'file': (filename, data)})
        assert response.status_code == status, response.text
    assert client.get('/api/notes').json() == []
