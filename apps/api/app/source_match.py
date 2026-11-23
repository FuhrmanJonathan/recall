"""Find where a flashcard came from inside the notes it was generated from.

Standard library only, so it is cheap to test. Every function works on character offsets
into the original text, so the frontend can highlight exactly what we found.
"""

import re
from collections import Counter

_WORD = re.compile(r"\w+", re.UNICODE)
_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"',
                         "–": "-", "—": "-", " ": " "})
_STOPWORDS = frozenset(
    "a an and are as at be by for from has have how in is it its of on or that the this to "
    "was were what when where which who why with does do did can into than then there these "
    "those their they also about".split()
)

# How much a fuzzy window must share with the excerpt before we trust it.
MIN_WINDOW_OVERLAP = 0.6
CONTEXT_CHARS = 700


def _words(text: str) -> list[tuple[str, int, int]]:
    """(lowercased word, start, end) for every word in ``text``."""
    folded = text.translate(_QUOTES)
    return [(m.group().lower(), m.start(), m.end()) for m in _WORD.finditer(folded)]


def locate(text: str, excerpt: str | None) -> tuple[int, int] | None:
    """Return the (start, end) span of ``excerpt`` in ``text``, or None if it isn't there.

    Tries an exact match, then a match that ignores case, spacing and punctuation, then the
    run of words that overlaps the excerpt most (the model sometimes changes a word or two).
    """
    excerpt = (excerpt or "").strip()
    if not text or not excerpt:
        return None
    at = text.find(excerpt)
    if at >= 0:
        return at, at + len(excerpt)

    words = _words(text)
    wanted = [w for w, _, _ in _words(excerpt)]
    if not words or not wanted:
        return None

    # Same words in the same order, ignoring case, whitespace and punctuation.
    n = len(wanted)
    tokens = [w for w, _, _ in words]
    for i in range(len(tokens) - n + 1):
        if tokens[i] == wanted[0] and tokens[i:i + n] == wanted:
            return words[i][1], words[i + n - 1][2]

    # Fuzzy: slide a window the excerpt's length and keep the one sharing the most words.
    if n > len(tokens):
        n = len(tokens)
    need = Counter(wanted)
    have = Counter(tokens[:n])
    shared = sum((have & need).values())
    best, best_at = shared, 0
    for i in range(1, len(tokens) - n + 1):
        out, new = tokens[i - 1], tokens[i + n - 1]
        if have[out] <= need[out]:
            shared -= 1
        have[out] -= 1
        have[new] += 1
        if have[new] <= need[new]:
            shared += 1
        if shared > best:
            best, best_at = shared, i
    if best / len(wanted) < MIN_WINDOW_OVERLAP:
        return None
    return words[best_at][1], words[best_at + n - 1][2]


def _terms(text: str) -> set[str]:
    return {w for w, _, _ in _words(text) if len(w) > 2 and w not in _STOPWORDS}


def best_passage(text: str, question: str, answer: str) -> tuple[int, int] | None:
    """For cards without a saved excerpt (hand-made or older cards), guess the paragraph
    or line of the notes that shares the most key terms with the card."""
    terms = _terms(f"{question} {answer}")
    if not text or not terms:
        return None
    answer_terms = _terms(answer)
    best: tuple[float, int, int] | None = None
    for match in re.finditer(r"[^\n]+", text):
        found = _terms(match.group())
        if not found:
            continue
        # Answer terms count double: the answer is what the student needs to reread.
        score = len(found & terms) + len(found & answer_terms)
        if best is None or score > best[0]:
            best = (score, match.start(), match.end())
    if best is None or best[0] < 3:
        return None
    return best[1], best[2]


def context(text: str, start: int, end: int, radius: int = CONTEXT_CHARS) -> dict:
    """Split ``text`` around a span into before / match / after, cut at line breaks."""
    lo = max(0, start - radius)
    if lo > 0:
        newline = text.find("\n", lo, start)
        lo = newline + 1 if newline >= 0 else lo
    hi = min(len(text), end + radius)
    if hi < len(text):
        newline = text.rfind("\n", end, hi)
        hi = newline if newline >= 0 else hi
    return {
        "before": text[lo:start],
        "match": text[start:end],
        "after": text[end:hi],
        "more_before": lo > 0,
        "more_after": hi < len(text),
    }
