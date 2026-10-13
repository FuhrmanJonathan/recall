"""Flashcard generation with OpenAI.
"""

import asyncio
import base64

from openai import AsyncOpenAI, OpenAIError
from pydantic import BaseModel

from app import config
from app.text import split_into_chunks

INSTRUCTIONS = """\
You turn a student's class notes into spaced-repetition flashcards.

- Cover every distinct fact, definition, term, process step, formula and example in the \
material. Do not skip content and do not add facts that are not in the material.
- One idea per card. The question must be short, specific and make sense on its own \
(never say "according to the notes").
- The answer must be concise (usually 1-3 sentences) but complete.
- Prefer questions that test recall or understanding (what / why / how / compare).
- Write the cards in the same language as the material.
- No duplicate cards.
"""

OCR_NOTE = (
    "This text was produced by OCR from photos of written notes, so it may contain "
    "recognition mistakes. Fix obvious errors using context. If a passage is unreadable, "
    "skip it instead of guessing."
)


class CardDraft(BaseModel):
    question: str
    answer: str


class CardSet(BaseModel):
    cards: list[CardDraft]


class GenerationError(RuntimeError):
    """OpenAI could not produce flashcards."""


_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        try:
            _client = AsyncOpenAI()  # reads OPENAI_API_KEY from the environment
        except OpenAIError as exc:
            raise GenerationError(
                "OpenAI is not configured. Set the OPENAI_API_KEY environment variable."
            ) from exc
    return _client


async def _generate(content: list[dict]) -> list[CardDraft]:
    options: dict = {}
    if config.OPENAI_REASONING_EFFORT:
        options["reasoning"] = {"effort": config.OPENAI_REASONING_EFFORT}

    try:
        response = await get_client().responses.parse(
            model=config.OPENAI_MODEL,
            instructions=INSTRUCTIONS,
            input=[{"role": "user", "content": content}],
            text_format=CardSet,
            **options,
        )
    except OpenAIError as exc:
        raise GenerationError(f"OpenAI request failed: {exc}") from exc

    if response.output_parsed is None:
        raise GenerationError("OpenAI did not return any flashcards.")
    return response.output_parsed.cards


def dedupe_cards(cards: list[CardDraft]) -> list[CardDraft]:
    """Drop empty cards and cards whose question repeats an earlier one."""
    seen: set[str] = set()
    unique: list[CardDraft] = []
    for card in cards:
        question, answer = card.question.strip(), card.answer.strip()
        key = " ".join(question.lower().split())
        if not question or not answer or key in seen:
            continue
        seen.add(key)
        unique.append(CardDraft(question=question, answer=answer))
    return unique


async def generate_cards_from_pdf(data: bytes, filename: str) -> list[CardDraft]:
    """Send the PDF straight to OpenAI (it reads both the text and the page images)."""
    encoded = base64.b64encode(data).decode("ascii")
    content = [
        {
            "type": "input_file",
            "filename": filename or "notes.pdf",
            "file_data": f"data:application/pdf;base64,{encoded}",
        },
        {"type": "input_text", "text": "Create flashcards from the attached notes."},
    ]
    return dedupe_cards(await _generate(content))


async def generate_cards_from_text(text: str, *, from_ocr: bool = False) -> list[CardDraft]:
    """Split cleaned text into chunks (text.split_into_chunks) and generate cards for each."""
    chunks = split_into_chunks(text, config.GENERATION_CHUNK_CHARS)
    limiter = asyncio.Semaphore(config.MAX_CONCURRENT_REQUESTS)

    async def run(index: int, chunk: str) -> list[CardDraft]:
        header = f"Create flashcards from these notes (part {index} of {len(chunks)}).\n"
        if from_ocr:
            header += OCR_NOTE + "\n"
        async with limiter:
            return await _generate([{"type": "input_text", "text": f"{header}\n{chunk}"}])

    results = await asyncio.gather(*(run(i, c) for i, c in enumerate(chunks, start=1)))
    return dedupe_cards([card for group in results for card in group])
