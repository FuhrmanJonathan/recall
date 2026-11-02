"""Atomic deck editing, ownership, and preservation of existing study data."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.test_auth import client, engine, signup  # noqa: F401
from recall_db.models import CardLabel, CardReviewState, Deck, Flashcard, Review


def seed(client, engine):
    user = signup(client).json()
    with Session(engine) as session:
        deck = Deck(user_id=user['id'], title='Biology')
        deck.flashcards = [Flashcard(question='Old question', answer='Old answer', needs_review=True),
                           Flashcard(question='Remove me', answer='Answer')]
        session.add(deck)
        session.commit()
        deck_id = deck.id
        ids = [card.id for card in deck.flashcards]
        for card_id in ids:
            session.add(CardLabel(flashcard_id=card_id, name='biology'))
            session.add(Review(flashcard_id=card_id, user_id=user['id'], rating='Good'))
            session.add(CardReviewState(flashcard_id=card_id, user_id=user['id'], repetitions=2, interval_days=6))
        session.commit()
    return deck_id, ids


def test_save_add_delete_persist_and_preserve_retained_study_data(client, engine):
    deck_id, ids = seed(client, engine)
    body = {'title': '  Cells  ', 'version': 1, 'flashcards': [
        {'id': ids[0], 'question': ' What is mitosis? ', 'answer': ' Cell division. ', 'needs_review': False},
        {'question': 'What is DNA?', 'answer': 'Genetic material.', 'needs_review': True},
    ]}
    response = client.put(f'/api/decks/{deck_id}', json=body)
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved['title'] == 'Cells'
    assert len(saved['flashcards']) == 2
    assert saved['flashcards'][0] == {'id': ids[0], 'question': 'What is mitosis?', 'answer': 'Cell division.', 'needs_review': False}
    assert saved['flashcards'][1]['needs_review'] is True
    assert client.get(f'/api/decks/{deck_id}').json() == saved
    assert client.get('/api/decks').json()[0]['card_count'] == 2
    with Session(engine) as session:
        assert session.get(Flashcard, ids[1]) is None
        assert session.get(CardReviewState, (1, ids[0])).repetitions == 2
        assert session.get(CardReviewState, (1, ids[1])) is None
        assert session.get(CardLabel, (ids[0], 'biology')) is not None
        assert session.get(CardLabel, (ids[1], 'biology')) is None
        assert len(session.scalars(select(Review)).all()) == 1


def test_editor_requires_login_and_owned_deck(client, engine):
    deck_id, ids = seed(client, engine)
    body = {'title': 'Stolen', 'version': 1, 'flashcards': []}
    client.post('/api/auth/logout')
    assert client.put(f'/api/decks/{deck_id}', json=body).status_code == 401
    signup(client, {'email': 'other@example.com', 'password': 'study-password'})
    assert client.put(f'/api/decks/{deck_id}', json=body).status_code == 404
    with Session(engine) as session:
        assert session.get(Deck, deck_id).title == 'Biology'
        assert session.get(Flashcard, ids[0]) is not None


def test_foreign_and_duplicate_card_ids_reject_whole_edit(client, engine):
    deck_id, ids = seed(client, engine)
    with Session(engine) as session:
        other = Deck(user_id=1, title='Other')
        other.flashcards = [Flashcard(question='Private', answer='Private')]
        session.add(other)
        session.commit()
        foreign_id = other.flashcards[0].id
    original = client.get(f'/api/decks/{deck_id}').json()
    for card_ids in [[ids[0], ids[0]], [foreign_id], [999999]]:
        result = client.put(f'/api/decks/{deck_id}', json={'title': 'Changed', 'version': 1, 'flashcards': [
            {'id': card_id, 'question': 'Changed', 'answer': 'Changed'} for card_id in card_ids
        ]})
        assert result.status_code == 422
        assert client.get(f'/api/decks/{deck_id}').json() == original


def test_blank_and_oversized_content_rejected_without_mutation(client, engine):
    deck_id, ids = seed(client, engine)
    original = client.get(f'/api/decks/{deck_id}').json()
    for changes in [{'title': '  '}, {'title': 'x' * 201}, {'question': '  '}, {'answer': ''},
                    {'question': 'x' * 2001}, {'answer': 'x' * 5001}]:
        card = {'id': ids[0], 'question': 'Valid', 'answer': 'Valid'}
        card.update({k: v for k, v in changes.items() if k != 'title'})
        body = {'title': changes.get('title', 'Valid'), 'version': 1, 'flashcards': [card]}
        assert client.put(f'/api/decks/{deck_id}', json=body).status_code == 422
        assert client.get(f'/api/decks/{deck_id}').json() == original


def test_empty_deck_can_be_saved_then_repopulated(client, engine):
    deck_id, _ = seed(client, engine)
    response = client.put(f'/api/decks/{deck_id}', json={'title': 'Empty', 'version': 1, 'flashcards': []})
    assert response.status_code == 200, response.text
    assert response.json()['flashcards'] == []
    response = client.put(f'/api/decks/{deck_id}', json={'title': 'Restarted', 'version': 2, 'flashcards': [{'question': 'Q', 'answer': 'A'}]})
    assert response.status_code == 200
    assert len(response.json()['flashcards']) == 1


def test_stale_editor_cannot_remove_newer_cards(client, engine):
    deck_id, _ = seed(client, engine)
    original = client.get(f'/api/decks/{deck_id}').json()
    updated = {**original, 'flashcards': [*original['flashcards'], {'question': 'New card', 'answer': 'Keep me'}]}
    updated.pop('id')
    first = client.put(f'/api/decks/{deck_id}', json=updated)
    assert first.status_code == 200, first.text
    stale = {key: value for key, value in original.items() if key != 'id'}
    stale['title'] = 'Stale title'
    assert client.put(f'/api/decks/{deck_id}', json=stale).status_code == 409
    assert client.get(f'/api/decks/{deck_id}').json() == first.json()


def test_single_card_update_invalidates_deck_editor(client, engine):
    deck_id, ids = seed(client, engine)
    before = client.get(f'/api/decks/{deck_id}').json()
    assert client.patch(f'/api/flashcards/{ids[0]}', json={'answer': 'Updated elsewhere'}).status_code == 200
    stale = {key: value for key, value in before.items() if key != 'id'}
    assert client.put(f'/api/decks/{deck_id}', json=stale).status_code == 409
    assert client.get(f'/api/decks/{deck_id}').json()['flashcards'][0]['answer'] == 'Updated elsewhere'


def test_manual_creation_and_generation_availability(client, monkeypatch):
    assert client.post('/api/decks', json={'title': 'Biology'}).status_code == 401
    assert client.get('/api/flashcards/status').status_code == 401
    signup(client)
    response = client.post('/api/decks', json={'title': '  My first deck  '})
    assert response.status_code == 201, response.text
    deck = client.get(f"/api/decks/{response.json()['id']}").json()
    assert deck['title'] == 'My first deck'
    assert deck['version'] == 1
    assert deck['flashcards'] == []
    assert client.post('/api/decks', json={'title': '  '}).status_code == 422
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)
    assert client.get('/api/flashcards/status').json()['configured'] is False
    monkeypatch.setenv('OPENAI_API_KEY', 'test-configuration-only')
    assert client.get('/api/flashcards/status').json()['configured'] is True


def test_reminder_configuration_is_private_and_does_not_claim_delivery(client, monkeypatch):
    assert client.get('/api/reminders/status').status_code == 401
    signup(client)
    monkeypatch.delenv('RESEND_API_KEY', raising=False)
    assert client.get('/api/reminders/status').json() == {'email_configured': False}
