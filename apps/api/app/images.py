from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session, undefer

from app.deps import get_current_user, get_session
from recall_db.models import CardImage, Deck, Flashcard, User

router = APIRouter(prefix="/api", tags=["images"])

MAX_BYTES = 5 * 1024 * 1024
MAX_PER_CARD = 10
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=31536000, immutable",
}


def sniff(data: bytes) -> str | None:
    """Detect the real type from the file's bytes. SVG is deliberately not allowed."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


@router.post("/cards/{card_id}/images")
def upload_image(
    card_id: int,
    side: str = Form(...),
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if side not in ("question", "answer"):
        raise HTTPException(422, "Side must be 'question' or 'answer'.")

    card = session.scalar(
        select(Flashcard)
        .join(Deck, Deck.id == Flashcard.deck_id)
        .where(Flashcard.id == card_id, Deck.user_id == user.id)
    )
    if card is None:
        raise HTTPException(404, "Card not found.")

    count = session.scalar(
        select(func.count()).select_from(CardImage).where(CardImage.flashcard_id == card_id)
    )
    if count >= MAX_PER_CARD:
        raise HTTPException(422, f"A card can have up to {MAX_PER_CARD} images.")

    data = file.file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Image must be under 5 MB.")
    content_type = sniff(data)
    if content_type is None:
        raise HTTPException(422, "Use a PNG, JPG, or WEBP image.")

    image = CardImage(flashcard_id=card_id, side=side, content_type=content_type, data=data)
    session.add(image)
    session.commit()
    return {"id": image.id, "side": image.side}


def owned_image(session: Session, image_id: int, user: User) -> CardImage:
    image = session.scalar(
        select(CardImage)
        .options(undefer(CardImage.data))
        .join(Flashcard, Flashcard.id == CardImage.flashcard_id)
        .join(Deck, Deck.id == Flashcard.deck_id)
        .where(CardImage.id == image_id, Deck.user_id == user.id)
    )
    if image is None:
        raise HTTPException(404, "Image not found.")
    return image


@router.get("/images/{image_id}")
def get_image(
    image_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    image = owned_image(session, image_id, user)
    return Response(content=image.data, media_type=image.content_type, headers=SECURITY_HEADERS)


@router.delete("/images/{image_id}", status_code=204)
def delete_image(
    image_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    image = owned_image(session, image_id, user)
    session.delete(image)
    session.commit()
    return Response(status_code=204)