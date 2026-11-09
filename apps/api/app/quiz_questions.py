"""Saved quiz text, separate from the source card. Never invokes AI."""
from app.flashcards import clean_blank
from recall_db.models import Flashcard, QuizQuestion

BLANK = "________"


def question_data(card: Flashcard) -> dict | None:
    if card.quiz_question is not None:
        q = card.quiz_question
        return {"question": q.question, "answer": q.answer, "context": q.context, "version": q.version}
    blank = clean_blank(card.answer.strip(), card.cloze_blank)
    if not blank:
        return None
    return {"question": card.answer.strip().replace(blank, BLANK), "answer": blank,
            "context": card.question, "version": 0}


def preserve_question(card: Flashcard) -> None:
    """Freeze a generated question before editing its source card."""
    if card.quiz_question is None:
        data = question_data(card)
        if data:
            card.quiz_question = QuizQuestion(question=data["question"], answer=data["answer"],
                                             context=data["context"], version=1)


def question_exercise(card: Flashcard) -> dict | None:
    data = question_data(card)
    if data is None:
        return None
    before, _, after = data["question"].partition(BLANK)
    return {"source_card_id": card.id, "context": data["context"], "before": before,
            "answer": data["answer"], "after": after}
