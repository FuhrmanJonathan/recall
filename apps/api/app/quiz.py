"""Quizzes use saved questions. Results and retry questions belong to the learner."""

from datetime import datetime, timezone
import hashlib
import json
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_session
from app.quiz_questions import BLANK, question_data, question_exercise
from app.quiz_scoring import score_attempt, summarize
from recall_db.models import Deck, Flashcard, QuizQuestion, QuizRun, User

router = APIRouter(prefix="/api/quiz", tags=["quiz"])
CardId = Annotated[int, Field(strict=True, gt=0)]


class QuizIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    card_ids: list[CardId] = Field(min_length=1, max_length=100)
    # Retained for older clients. Saved questions do not require a paid call.
    confirmed_large: bool = Field(default=False, strict=True)


class RunIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    card_ids: list[CardId] | None = Field(default=None, min_length=1, max_length=100)
    parent_id: UUID | None = None
    mode: Literal["cards", "missed", "repeat"] = "cards"

    @model_validator(mode="after")
    def valid_source(self):
        if self.mode == "cards":
            if not self.card_ids or self.parent_id is not None:
                raise ValueError("Select cards for a new quiz.")
        elif self.parent_id is None or self.card_ids is not None:
            raise ValueError("Select a completed quiz to practice again.")
        return self


class AttemptIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(max_length=2000, strict=True)
    revealed: bool = Field(strict=True)
    markedCorrect: bool = Field(default=False, strict=True)


class CompleteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attempts: list[AttemptIn] = Field(min_length=1, max_length=100)


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def sources(body: QuizIn, session: Session, user: User):
    ids = list(dict.fromkeys(body.card_ids))
    owned = session.scalars(select(Flashcard).join(Deck).where(
        Flashcard.id.in_(ids), Deck.user_id == user.id)).all()
    by_id = {card.id: card for card in owned}
    if len(by_id) != len(ids):
        raise HTTPException(404, "One or more cards are unavailable. Return to cards and reload.")
    cards = [question_exercise(by_id[i]) for i in ids]
    missing = [i for i, card in zip(ids, cards) if card is None]
    if missing:
        numbers = ", ".join(map(str, missing))
        raise HTTPException(422, f"Cards {numbers} have no saved quiz question. Use Edit quiz to add one, or deselect these cards.")
    if sum(sum(len(c[key]) for key in ("context", "before", "answer", "after")) for c in cards) > 12000:
        raise HTTPException(422, "Selected cards are too long. Choose fewer or shorter cards.")
    return cards, digest([user.id, cards])


def exercise(card: dict) -> dict:
    return card


def owned_run(session: Session, user: User, run_id: str) -> QuizRun:
    run = session.get(QuizRun, run_id)
    if run is None or run.user_id != user.id:
        raise HTTPException(404, "Quiz not found.")
    return run


def utc_text(value: datetime | None):
    if value is None:
        return None
    # SQLite returns naive UTC; PostgreSQL may return an aware non-UTC value.
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def run_data(run: QuizRun, *, detail=True):
    summary = summarize(run.attempts) if run.attempts is not None else None
    result = {"id": run.id, "parent_id": run.parent_id, "mode": run.mode,
              "created_at": utc_text(run.created_at), "completed_at": utc_text(run.completed_at),
              "question_count": len(run.exercises), "summary": summary}
    if detail:
        result.update(exercises=run.exercises, attempts=run.attempts)
    return result


@router.post("/sources")
def validate_sources(body: QuizIn, response: Response,
                     session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    _, fingerprint = sources(body, session, user)
    return {"fingerprint": fingerprint}


@router.post("/cloze")
def create_quiz(body: QuizIn, response: Response,
                session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    cards, fingerprint = sources(body, session, user)
    return {"provider": "stored", "fingerprint": fingerprint, "exercises": [exercise(c) for c in cards]}


@router.post("/runs")
def start_run(body: RunIn, response: Response,
              session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    run_id = str(body.request_id)
    request_hash = digest({"cards": list(dict.fromkeys(body.card_ids or [])),
                           "parent": str(body.parent_id) if body.parent_id else None, "mode": body.mode})

    def replay(existing):
        if existing.user_id != user.id:
            raise HTTPException(404, "Quiz not found.")
        if existing.request_hash != request_hash:
            raise HTTPException(409, "This quiz request was already used. Start a new quiz.")
        return run_data(existing)

    existing = session.get(QuizRun, run_id)
    if existing:
        return replay(existing)
    if body.mode == "cards":
        cards, _ = sources(QuizIn(card_ids=body.card_ids), session, user)
        questions = [exercise(c) for c in cards]
    else:
        parent = owned_run(session, user, str(body.parent_id))
        if parent.completed_at is None or parent.attempts is None:
            raise HTTPException(409, "Finish and save the original quiz first.")
        questions = [q for q, a in zip(parent.exercises, parent.attempts)
                     if body.mode == "repeat" or a["result"] != "correct"]
        if not questions:
            raise HTTPException(409, "No missed questions in this quiz.")
    run = QuizRun(id=run_id, user_id=user.id, parent_id=str(body.parent_id) if body.parent_id else None,
                  mode=body.mode, request_hash=request_hash, exercises=questions)
    session.add(run)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = session.get(QuizRun, run_id)
        if existing:
            return replay(existing)
        raise
    session.refresh(run)
    response.status_code = 201
    return run_data(run)


@router.get("/history")
def history(response: Response, offset: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=50),
            session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    conditions = (QuizRun.user_id == user.id, QuizRun.completed_at.is_not(None))
    total = session.scalar(select(func.count()).select_from(QuizRun).where(*conditions))
    runs = session.scalars(select(QuizRun).where(*conditions).order_by(
        QuizRun.completed_at.desc(), QuizRun.id.desc()).offset(offset).limit(limit)).all()
    return {"items": [run_data(run, detail=False) for run in runs], "total": total}


@router.get("/runs/{run_id}")
def get_run(run_id: UUID, response: Response,
            session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    return run_data(owned_run(session, user, str(run_id)))


@router.put("/runs/{run_id}/complete")
def complete_run(run_id: UUID, body: CompleteIn, response: Response,
                 session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    run = owned_run(session, user, str(run_id))
    if len(body.attempts) != len(run.exercises):
        raise HTTPException(422, "Submit one answer for every question.")
    attempts = [{**a.model_dump(), "result": score_attempt(q["answer"], a.model_dump())}
                for q, a in zip(run.exercises, body.attempts)]
    # One atomic transition protects both double clicks and competing browser tabs.
    session.execute(update(QuizRun).where(QuizRun.id == run.id, QuizRun.completed_at.is_(None)).values(
        attempts=attempts, completed_at=datetime.now(timezone.utc)), execution_options={"synchronize_session": False})
    session.commit()
    session.refresh(run)
    if run.attempts != attempts:
        raise HTTPException(409, "This quiz already has saved results. Open its history to view them.")
    return run_data(run)


class QuestionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(strict=True, min_length=1, max_length=5000)
    answer: str = Field(strict=True, min_length=1, max_length=200)
    version: int = Field(strict=True, ge=0)

    @model_validator(mode="after")
    def valid_question(self):
        self.question = self.question.strip()
        self.answer = self.answer.strip()
        if BLANK not in self.question or not self.question.replace(BLANK, "").strip():
            raise ValueError("Write a question containing ________ and some surrounding text.")
        if not self.answer or BLANK in self.answer:
            raise ValueError("Enter the correct answer without a blank marker.")
        return self


def owned_card(session: Session, user: User, card_id: int) -> Flashcard:
    card = session.scalar(select(Flashcard).join(Deck).where(
        Flashcard.id == card_id, Deck.user_id == user.id))
    if card is None:
        raise HTTPException(404, "Card not found.")
    return card


def editor_data(card: Flashcard):
    data = question_data(card)
    return {"card_id": card.id, "card_question": card.question, "card_answer": card.answer,
            "question": ((data["context"] + "\n" if data["context"] else "") + data["question"]) if data else "",
            "answer": data["answer"] if data else "", "version": data["version"] if data else 0}


@router.get("/cards/{card_id}/question")
def get_question(card_id: int, response: Response,
                 session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    return editor_data(owned_card(session, user, card_id))


@router.put("/cards/{card_id}/question")
def save_question(card_id: int, body: QuestionIn, response: Response,
                  session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    card = owned_card(session, user, card_id)
    if body.version == 0:
        if card.quiz_question is not None:
            raise HTTPException(409, "This quiz was changed elsewhere. Reload before editing again.")
        session.add(QuizQuestion(flashcard_id=card.id, question=body.question,
                                answer=body.answer, context="", version=1))
    else:
        changed = session.execute(update(QuizQuestion).where(
            QuizQuestion.flashcard_id == card.id, QuizQuestion.version == body.version
        ).values(question=body.question, answer=body.answer, context="", version=body.version + 1))
        if changed.rowcount != 1:
            session.rollback()
            raise HTTPException(409, "This quiz was changed elsewhere. Reload before editing again.")
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "This quiz was changed elsewhere. Reload before editing again.")
    session.expire(card, ["quiz_question"])
    return editor_data(card)
