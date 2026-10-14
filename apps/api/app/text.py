"""Helpers for cleaning up text sent to the API and splitting it into chunks.

Chunks are what later steps (like flashcard generation) will work on, so a
long set of notes doesn't have to be handled all at once.
"""

MAX_CHUNK_CHARS = 1500


def clean_text(raw: str) -> str:
    """Normalize line endings, trim each line, and collapse extra blank lines."""
    # Windows uses "\r\n" and old Macs use "\r" for new lines; switch both to "\n".
    text = raw.replace("\r\n", "\n")
    text = text.replace("\r", "\n")

    lines = []
    for line in text.split("\n"):
        lines.append(line.strip())

    cleaned: list[str] = []
    for line in lines:
        # Keep at most one blank line in a row (it marks a paragraph break).
        if line == "" and (not cleaned or cleaned[-1] == ""):
            continue
        cleaned.append(line)

    return "\n".join(cleaned).strip()


def split_into_chunks(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    """Group paragraphs into chunks of at most max_chars characters.

    A single paragraph longer than max_chars is split on word boundaries.
    """
    chunks: list[str] = []
    current = ""

    for paragraph in text.split("\n\n"):
        for piece in _split_long_paragraph(paragraph, max_chars):
            if current and len(current) + 2 + len(piece) > max_chars:
                chunks.append(current)
                current = piece
            else:
                current = f"{current}\n\n{piece}" if current else piece

    if current:
        chunks.append(current)
    return chunks


def _split_long_paragraph(paragraph: str, max_chars: int) -> list[str]:
    if len(paragraph) <= max_chars:
        return [paragraph]

    pieces: list[str] = []
    current = ""
    for word in paragraph.split():
        if current and len(current) + 1 + len(word) > max_chars:
            pieces.append(current)
            current = word
        else:
            current = f"{current} {word}" if current else word
    if current:
        pieces.append(current)
    return pieces
