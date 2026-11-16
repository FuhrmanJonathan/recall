"""Deterministic quiz scoring. Keep symbol aliases aligned with the web scorer."""
import math
import re
import unicodedata

_SYMBOLS = dict(zip("αβγδεθλμµπρσς∑φωτ∞", (
    "alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu", "mu",
    "pi", "rho", "sigma", "sigma", "sigma", "phi", "omega", "tau", "infinity")))


def normalize_answer(text: str) -> str:
    text = unicodedata.normalize("NFC", text).lower()
    text = "".join(f" {_SYMBOLS[c]} " if c in _SYMBOLS else c for c in text)
    for symbol, alias in {"×": "*", "÷": "/", "−": "-", "≤": "<=", "≥": ">=", "≠": "!="}.items():
        text = text.replace(symbol, alias)
    text = re.sub(r"\s+", " ", text.strip())
    return re.sub(r"\s*([*/+=<>!−-])\s*", r"\1", text)


def score_attempt(answer: str, attempt: dict) -> str:
    if not attempt["revealed"] or not attempt["text"].strip():
        return "unanswered"
    if attempt["markedCorrect"] or normalize_answer(answer) == normalize_answer(attempt["text"]):
        return "correct"
    return "incorrect"


def summarize(attempts: list[dict]) -> dict:
    counts = {key: sum(a["result"] == key for a in attempts) for key in ("correct", "incorrect", "unanswered")}
    return {**counts, "accuracy": math.floor(counts["correct"] / len(attempts) * 100 + .5) if attempts else 0}
