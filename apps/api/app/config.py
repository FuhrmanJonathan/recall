"""Settings for the API. ."""

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# Enable for HTTPS deployments; local development uses HTTP.
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "false").lower() in {"1", "true", "yes"}

# Public web client ID; an empty value disables Google sign-in.
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()

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

# --- Auto-tagging (app/autotag.py) ---
# Cards are embedded, clustered with HDBSCAN, and only then named by OPENAI_MODEL.
OPENAI_EMBEDDING_MODEL = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
AUTOTAG_PCA_DIMS = 15          # embeddings are reduced to this many dimensions before clustering
AUTOTAG_MIN_SAMPLES = 2        # HDBSCAN min_samples; lower = fewer cards left untagged
AUTOTAG_NOISE_SIMILARITY = 0.5  # an unclustered card joins a cluster above this cosine similarity

# --- Flashcard generation ---
# Optional "what should this deck focus on?" text from the student.
MAX_FOCUS_CHARS = 300
