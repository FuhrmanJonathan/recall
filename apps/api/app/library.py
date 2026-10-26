"""A small, user-owned library. Uploading notes never calls AI."""

from datetime import datetime
from pathlib import PurePath

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.deps import get_current_user, get_session
from recall_db.models import Deck, Flashcard, NoteUpload, User

router = APIRouter(prefix="/api", tags=["library"])
MAX_NOTE_BYTES = 5 * 1024 * 1024


class LibraryItem(BaseModel):
    id: int
    title: str
    created_at: datetime
    card_count: int = 0
    flagged_count: int = 0  # cards flagged "needs review"


@router.get("/decks", response_model=list[LibraryItem])
def list_decks(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    rows = session.execute(
        select(
            Deck.id, Deck.title, Deck.created_at,
            func.count(Flashcard.id).label("card_count"),
            func.coalesce(
                func.sum(case((Flashcard.needs_review.is_(True), 1), else_=0)), 0
            ).label("flagged_count"),
        )
        .outerjoin(Flashcard).where(Deck.user_id == user.id)
        .group_by(Deck.id).order_by(Deck.created_at.desc(), Deck.id.desc())
    )
    return [dict(row._mapping) for row in rows]


@router.get("/notes", response_model=list[LibraryItem])
def list_notes(
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    rows = session.execute(
        select(NoteUpload.id, NoteUpload.title, NoteUpload.created_at)
        .where(NoteUpload.user_id == user.id)
        .order_by(NoteUpload.created_at.desc(), NoteUpload.id.desc())
    )
    return [dict(row._mapping) for row in rows]


@router.post("/notes", status_code=201, response_model=LibraryItem)
async def upload_notes(
    file: UploadFile,
    title: str = Form(min_length=1, max_length=200),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    filename = PurePath(file.filename or "").name
    if PurePath(filename).suffix.lower() not in {".pdf", ".docx", ".txt"}:
        raise HTTPException(415, "Choose a PDF, DOCX, or TXT file.")
    if not title.strip() or len(filename) > 255:
        raise HTTPException(400, "Enter a title and use a filename under 256 characters.")
    data = await file.read(MAX_NOTE_BYTES + 1)
    if not data:
        raise HTTPException(400, "The file is empty.")
    if len(data) > MAX_NOTE_BYTES:
        raise HTTPException(413, "File is too large (max 5 MB).")
    note = NoteUpload(user_id=user.id, title=title.strip(), filename=filename, data=data)
    session.add(note)
    session.commit()
    session.refresh(note)
    return LibraryItem(id=note.id, title=note.title, created_at=note.created_at)


@router.get("/notes/{note_id}/download")
def download_notes(
    note_id: int,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
):
    note = session.scalar(select(NoteUpload).where(
        NoteUpload.id == note_id, NoteUpload.user_id == user.id
    ))
    if note is None:
        raise HTTPException(404, "Notes not found.")
    from urllib.parse import quote

    return Response(note.data, media_type="application/octet-stream", headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(note.filename, safe='')}",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
    })
