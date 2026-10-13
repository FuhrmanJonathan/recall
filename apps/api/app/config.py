"""Settings for the API. ."""

import os

# --- Limits (MAX_TEXT_CHARS / MAX_UPLOAD_BYTES were previously defined in main.py) ---
MAX_TEXT_CHARS = 50_000
MAX_UPLOAD_BYTES = 1_000_000  # .txt / .md uploads
MAX_DOCUMENT_BYTES = 20_000_000  # PDF and Word uploads
MAX_IMAGE_BYTES = 10_000_000  # photos / scans of written notes

# --- OpenAI ---
# The API key itself is read from OPENAI_API_KEY by the OpenAI SDK.
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-5.6-sol")
# Set to an empty string to leave the model's default reasoning effort alone.
OPENAI_REASONING_EFFORT = os.getenv("OPENAI_REASONING_EFFORT", "low")

# Text is split with text.split_into_chunks(); this is the chunk size used for
# flashcard generation (larger than the default so each request sees more context).
GENERATION_CHUNK_CHARS = 8_000
MAX_CONCURRENT_REQUESTS = 4

# --- OCR ---
OCR_MODEL_ID = os.getenv("OCR_MODEL_ID", "stepfun-ai/GOT-OCR-2.0-hf")
