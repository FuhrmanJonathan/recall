from app.source_match import best_passage, context, locate

NOTES = """Cell biology

Mitosis is the division of a nucleus into two identical nuclei.
It has four phases: prophase, metaphase, anaphase and telophase.

The mitochondria produce ATP through cellular respiration.
Ribosomes build proteins from amino acids."""


def test_exact_excerpt_is_found():
    excerpt = "The mitochondria produce ATP through cellular respiration."
    start, end = locate(NOTES, excerpt)
    assert NOTES[start:end] == excerpt


def test_case_spacing_and_punctuation_are_ignored():
    start, end = locate(NOTES, "it has FOUR phases:   prophase, metaphase,\nanaphase")
    assert NOTES[start:end] == "It has four phases: prophase, metaphase, anaphase"


def test_smart_quotes_and_dashes_match_plain_ones():
    text = "Osmosis - water moves to the side with more solute."
    start, end = locate(text, "Osmosis – water moves to the side")
    assert text[start:end] == "Osmosis - water moves to the side"


def test_a_slightly_reworded_excerpt_still_lands_in_the_right_place():
    start, end = locate(NOTES, "Mitochondria make ATP through cellular respiration")
    assert "mitochondria produce ATP" in NOTES[start:end]


def test_unrelated_excerpt_is_not_found():
    assert locate(NOTES, "The French Revolution began in 1789.") is None
    assert locate(NOTES, "") is None
    assert locate(NOTES, None) is None
    assert locate("", "Mitosis") is None


def test_best_passage_guesses_the_line_for_cards_without_an_excerpt():
    start, end = best_passage(NOTES, "What do ribosomes do?", "Build proteins from amino acids.")
    assert NOTES[start:end] == "Ribosomes build proteins from amino acids."


def test_best_passage_gives_up_without_enough_overlap():
    assert best_passage(NOTES, "Who wrote Hamlet?", "Shakespeare.") is None


def test_context_cuts_at_line_breaks():
    start, end = locate(NOTES, "The mitochondria produce ATP")
    ctx = context(NOTES, start, end, radius=30)
    assert ctx["match"] == "The mitochondria produce ATP"
    assert ctx["before"].strip() == ""  # the line above is cut off, not half-shown
    assert ctx["after"] == " through cellular respiration."
    assert ctx["more_before"] and ctx["more_after"]
    whole = context(NOTES, start, end, radius=10_000)
    assert whole["before"] + whole["match"] + whole["after"] == NOTES
    assert not whole["more_before"] and not whole["more_after"]
