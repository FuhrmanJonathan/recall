"""Auto-tagging: cluster the cards first (HDBSCAN), then let the LLM name each cluster.

The old approach asked the model to invent labels for every card while it wrote the cards.
That produced lots of near-duplicate, one-card tags and made every generation request
longer. Now:

  1. every card (question + answer) is embedded in ONE embeddings request,
  2. HDBSCAN groups similar cards. A group always has at least ``min_cluster_size`` (>= 2)
     cards, so a tag can never end up on just one card,
  3. ONE small chat request names every group at once,
  4. groups that got the same name are merged.

"general" mode uses big clusters (a few broad topics, which become deck labels).
"specific" mode uses smaller clusters (each card gets at most one concept tag).
Cards HDBSCAN calls "noise" join the nearest group if they're similar enough; otherwise
they stay untagged rather than getting a tag of their own.
"""

import logging
from collections import Counter

import numpy as np
from openai import OpenAIError
from pydantic import BaseModel

from app import config
from app.flashcards import CardDraft, GenerationError, get_client
from app.study import normalize_label

log = logging.getLogger(__name__)

NOISE = -1
TAG_MODES = ("general", "specific")
_SAMPLES_PER_CLUSTER = 8  # questions shown to the model when naming a cluster

NAMING_INSTRUCTIONS = """\
You name groups of flashcards from a student's deck. Each group was formed by clustering \
cards with similar content. Give every group ONE label that describes what all of its \
cards have in common.

- Labels are lowercase topic names of 1-3 words, with no commas, in the same language as \
the cards.
- Never use a generic label such as "general", "misc", "other", "notes" or "review".
- Return exactly one label for every group id you are given.
"""

NAMING_STYLE = {
    "general": (
        "Use BROAD subject-area or unit names, the way a textbook chapter would be titled "
        '(for example "cell biology" or "genetics"). Different groups may share a label if '
        "they belong to the same broad subject."
    ),
    "specific": (
        "Use the specific concept, process or structure the group is about (for example "
        '"krebs cycle" or "dna replication"), but it must fit EVERY card in the group, not '
        "just one of them. Give two groups the same label if they are about the same concept."
    ),
}


class ClusterName(BaseModel):
    group: int
    label: str


class ClusterNames(BaseModel):
    groups: list[ClusterName]


# --- clustering (pure numpy / scikit-learn, no network) ---------------------------------


def min_cluster_size(n_cards: int, mode: str) -> int:
    """Smallest group that may get its own tag. Always >= 2 so no tag covers one card."""
    if mode == "general":
        return max(2, n_cards // 6)
    # specific: small decks allow pairs; larger decks need bigger groups.
    return max(2, min(n_cards // 4, max(3, n_cards // 15)))


def _normalize(vectors: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    return vectors / np.where(norms == 0, 1, norms)


def cluster_embeddings(embeddings: np.ndarray, mode: str) -> np.ndarray:
    """Return a cluster id per card (``NOISE`` = no tag). Every real cluster has >= 2 cards."""
    from sklearn.cluster import HDBSCAN
    from sklearn.decomposition import PCA

    n = len(embeddings)
    if n < 2:
        return np.full(n, NOISE)
    unit = _normalize(np.asarray(embeddings, dtype=np.float64))

    size = min_cluster_size(n, mode)
    if n < 4:
        # Too few cards for density estimates; one group (general) or nothing (specific).
        return np.zeros(n, dtype=int) if mode == "general" else np.full(n, NOISE)

    # Embeddings have ~1500 dimensions, where distances all look alike. Reducing first
    # (the same idea as BERTopic's UMAP step) gives HDBSCAN much cleaner density.
    points = unit
    dims = min(config.AUTOTAG_PCA_DIMS, n - 1)
    if unit.shape[1] > dims:
        points = PCA(n_components=dims, random_state=0).fit_transform(unit)

    labels = HDBSCAN(
        min_cluster_size=size,
        min_samples=min(config.AUTOTAG_MIN_SAMPLES, size),
        cluster_selection_method="eom",
        copy=True,
    ).fit_predict(points)

    if (labels == NOISE).all():
        return np.zeros(n, dtype=int) if mode == "general" else labels
    return _attach_noise(unit, labels, mode)


def _attach_noise(unit: np.ndarray, labels: np.ndarray, mode: str) -> np.ndarray:
    """Put leftover cards into the closest cluster (always in general mode)."""
    labels = labels.copy()
    ids = sorted(set(labels) - {NOISE})
    centroids = _normalize(np.stack([unit[labels == i].mean(axis=0) for i in ids]))
    for idx in np.flatnonzero(labels == NOISE):
        sims = centroids @ unit[idx]
        best = int(np.argmax(sims))
        if mode == "general" or sims[best] >= config.AUTOTAG_NOISE_SIMILARITY:
            labels[idx] = ids[best]
    return labels


# --- OpenAI calls ------------------------------------------------------------------------


def _card_text(card: CardDraft) -> str:
    return f"{card.question}\n{card.answer}"


async def embed_cards(cards: list[CardDraft]) -> np.ndarray:
    try:
        response = await get_client().embeddings.create(
            model=config.OPENAI_EMBEDDING_MODEL, input=[_card_text(c) for c in cards]
        )
    except OpenAIError as exc:
        raise GenerationError(f"OpenAI embeddings request failed: {exc}") from exc
    rows = sorted(response.data, key=lambda item: item.index)
    return np.array([row.embedding for row in rows], dtype=np.float64)


async def name_clusters(
    cards: list[CardDraft], labels: np.ndarray, mode: str
) -> dict[int, str]:
    """One request that returns a label for every cluster id."""
    groups: dict[int, list[str]] = {}
    for card, label in zip(cards, labels):
        if label != NOISE:
            groups.setdefault(int(label), []).append(card.question)

    prompt = [NAMING_STYLE[mode], ""]
    for gid, questions in sorted(groups.items()):
        prompt.append(f'<group id="{gid}" cards="{len(questions)}">')
        prompt.extend(f"- {q}" for q in questions[:_SAMPLES_PER_CLUSTER])
        prompt.append("</group>")

    options: dict = {}
    if config.OPENAI_REASONING_EFFORT:
        options["reasoning"] = {"effort": config.OPENAI_REASONING_EFFORT}
    try:
        response = await get_client().responses.parse(
            model=config.OPENAI_MODEL,
            instructions=NAMING_INSTRUCTIONS,
            input=[{"role": "user", "content": [{"type": "input_text", "text": "\n".join(prompt)}]}],
            text_format=ClusterNames,
            **options,
        )
    except OpenAIError as exc:
        raise GenerationError(f"OpenAI request failed: {exc}") from exc
    if response.output_parsed is None:
        return {}

    names: dict[int, str] = {}
    for item in response.output_parsed.groups:
        if item.group not in groups:
            continue
        try:
            names[item.group] = normalize_label(item.label)
        except ValueError:
            continue
    return names


def tags_from_clusters(labels: np.ndarray, names: dict[int, str]) -> list[list[str]]:
    """One tag (or none) per card. Same-named clusters merge; tags on < 2 cards are dropped."""
    per_card = [[names[int(l)]] if int(l) in names else [] for l in labels]
    counts = Counter(tag for tags in per_card for tag in tags)
    return [[t for t in tags if counts[t] >= 2] for tags in per_card]


async def auto_tag(cards: list[CardDraft], mode: str | None) -> list[list[str]]:
    """Return a list of tag names for each card (same order). Never raises."""
    if mode not in NAMING_STYLE or len(cards) < 2:
        return [[] for _ in cards]
    try:
        embeddings = await embed_cards(cards)
        labels = cluster_embeddings(embeddings, mode)
        if (labels == NOISE).all():
            return [[] for _ in cards]
        names = await name_clusters(cards, labels, mode)
        return tags_from_clusters(labels, names)
    except Exception:  # tagging is optional; never lose a generated deck over it
        log.exception("Auto-tagging failed; saving the deck without tags.")
        return [[] for _ in cards]
