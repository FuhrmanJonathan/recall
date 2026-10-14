from sqlalchemy import select
from sqlalchemy.orm import Session

from recall_db.database import create_tables, engine
from recall_db.models import Deck, Flashcard, User


SAMPLE_EMAIL = "1234@recall.local"


def seed_sample_data(session: Session) -> None:
    #Insert a small dataset for local demonstrations
    if session.scalar(select(User).where(User.email == SAMPLE_EMAIL)):
        return

    user = User(email=SAMPLE_EMAIL, password_hash="placeholder")
    deck = Deck(title="Review", owner=user)
    deck.flashcards.extend(
        [
            Flashcard(
                question="What is 1+1?",
                answer="2",
            ),
            Flashcard(
                question="Cat",
                answer="A cute animal",
            ),
        ]
    )
    session.add(user)
    session.commit()


def main() -> None:
    create_tables()
    with Session(engine) as session:
        seed_sample_data(session)
    print("Database initialized with sample data.")


if __name__ == "__main__":
    main()
