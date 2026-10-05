from fastapi import FastAPI, HTTPException, UploadFile
from pydantic import BaseModel

from app.text import clean_text, split_into_chunks

MAX_TEXT_CHARS = 50_000
MAX_UPLOAD_BYTES = 1_000_000

app = FastAPI(title="Recall API")


class TextIn(BaseModel):
    text: str


class TextOut(BaseModel):
    text: str
    word_count: int
    chunks: list[str]


@app.get("/api/health")
def health() -> dict[str, str]:
    """Lets the frontend check that the backend is running."""
    return {"status": "ok"}


@app.post("/api/text")
def read_text(body: TextIn) -> TextOut:
    """Accept pasted notes as JSON and return them cleaned up and chunked."""
    return _process(body.text)


@app.post("/api/text/upload")
async def read_text_file(file: UploadFile) -> TextOut:
    """Accept a .txt file of notes and return it cleaned up and chunked."""
    if not (file.filename or "").lower().endswith(".txt"):
        raise HTTPException(status_code=415, detail="Only .txt files are supported.")

    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File is too large (max 1 MB).")

    try:
        raw = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File must be UTF-8 text.")

    return _process(raw)


def _process(raw: str) -> TextOut:
    text = clean_text(raw)
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty.")
    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(
            status_code=413, detail=f"Text is too long (max {MAX_TEXT_CHARS} characters)."
        )

    return TextOut(text=text, word_count=len(text.split()), chunks=split_into_chunks(text))
