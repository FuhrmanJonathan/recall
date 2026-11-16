import asyncio
from collections import Counter
from types import SimpleNamespace

import numpy as np
import pytest

from app import autotag
from app.flashcards import CardDraft


def _deck(sizes, dims=1536, seed=1):
    """Fake embeddings: one random direction per topic plus per-card noise."""
    rng = np.random.default_rng(seed)
    base = rng.normal(size=dims)
    rows, truth = [], []
    for topic, n in enumerate(sizes):
        center = base * 0.6 + rng.normal(size=dims)
        for _ in range(n):
            rows.append(center + rng.normal(size=dims) * 0.9)
            truth.append(topic)
    return np.array(rows), truth


@pytest.mark.parametrize("n", [2, 4, 12, 40, 150])
@pytest.mark.parametrize("mode", ["general", "specific"])
def test_min_cluster_size_is_never_one(n, mode):
    assert autotag.min_cluster_size(n, mode) >= 2


def test_specific_mode_finds_the_real_groups_and_never_tags_one_card():
    embeddings, truth = _deck((12, 10, 8, 1))
    labels = autotag.cluster_embeddings(embeddings, "specific")
    sizes = Counter(int(l) for l in labels if l != autotag.NOISE)
    assert len(sizes) == 3
    assert min(sizes.values()) >= 2
    for cluster in sizes:  # every cluster is one real topic
        assert len({truth[i] for i in np.flatnonzero(labels == cluster)}) == 1


def test_general_mode_makes_fewer_bigger_groups_and_tags_every_card():
    embeddings, _ = _deck((20, 15, 15, 10, 5, 3))
    general = autotag.cluster_embeddings(embeddings, "general")
    specific = autotag.cluster_embeddings(embeddings, "specific")
    assert autotag.NOISE not in general
    assert len(set(general)) < len(set(specific) - {autotag.NOISE})


def test_tiny_decks():
    one, _ = _deck((1,))
    three, _ = _deck((3,))
    assert list(autotag.cluster_embeddings(one, "general")) == [autotag.NOISE]
    assert list(autotag.cluster_embeddings(three, "general")) == [0, 0, 0]
    assert list(autotag.cluster_embeddings(three, "specific")) == [autotag.NOISE] * 3


def test_same_names_merge_and_single_card_tags_are_dropped():
    labels = np.array([0, 0, 1, -1, 2, 2, 3])
    names = {0: "krebs cycle", 1: "glycolysis", 2: "krebs cycle", 3: "atp"}
    # cluster 1 and 3 each ended up with one card after naming -> no tag for them
    tags = autotag.tags_from_clusters(labels, names)
    assert tags == [["krebs cycle"], ["krebs cycle"], [], [], ["krebs cycle"], ["krebs cycle"], []]


def test_auto_tag_embeds_once_and_names_once(monkeypatch):
    embeddings, truth = _deck((5, 5))
    cards = [CardDraft(question=f"Q{i}?", answer="A") for i in range(len(truth))]
    calls = {"embed": 0, "name": []}

    class FakeEmbeddings:
        async def create(self, **kwargs):
            calls["embed"] += 1
            assert len(kwargs["input"]) == len(cards)
            return SimpleNamespace(
                data=[SimpleNamespace(index=i, embedding=e.tolist()) for i, e in enumerate(embeddings)]
            )

    class FakeResponses:
        async def parse(self, **kwargs):
            calls["name"].append(kwargs)
            text = kwargs["input"][0]["content"][0]["text"]
            groups = [autotag.ClusterName(group=g, label=f"Topic {g}")
                      for g in range(10) if f'id="{g}"' in text]
            return SimpleNamespace(output_parsed=autotag.ClusterNames(groups=groups))

    fake = SimpleNamespace(embeddings=FakeEmbeddings(), responses=FakeResponses())
    monkeypatch.setattr(autotag, "get_client", lambda: fake)

    tags = asyncio.run(autotag.auto_tag(cards, "specific"))
    assert calls["embed"] == 1 and len(calls["name"]) == 1
    assert len({t[0] for t in tags if t}) == 2
    assert all(len(t) <= 1 for t in tags)
    counts = Counter(t[0] for t in tags if t)
    assert min(counts.values()) >= 2


def test_auto_tag_failure_saves_deck_without_tags(monkeypatch):
    def broken():
        raise RuntimeError("no network")

    monkeypatch.setattr(autotag, "get_client", broken)
    cards = [CardDraft(question="Q?", answer="A")] * 3
    assert asyncio.run(autotag.auto_tag(cards, "general")) == [[], [], []]
    assert asyncio.run(autotag.auto_tag(cards, None)) == [[], [], []]
