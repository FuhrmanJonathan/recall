import pytest
from app.quiz_scoring import normalize_answer, score_attempt, summarize


@pytest.mark.parametrize('answer,typed', [('σ','sigma'), ('Σ','SIGMA'), ('∑','sigma'), ('α','alpha'), ('μ','mu'), ('µ','mu'), ('a × b','a*b'), ('x ≤ 5','x<=5'), ('x ≥ 5','x >= 5'), ('x ≠ 5','x!=5'), (' Product   Owner ','product owner')])
def test_symbol_aliases(answer, typed):
    assert normalize_answer(answer) == normalize_answer(typed)


@pytest.mark.parametrize('answer,typed', [('x<5','x>5'), ('σ',''), ('x²','x2'), ('-5','5'), ('a/b','ab'), ('0.5','05')])
def test_meaningful_differences(answer, typed):
    assert normalize_answer(answer) != normalize_answer(typed)


def test_unanswered_overrides_self_mark_and_percentage_rounding():
    assert score_attempt('Two', {'text':'', 'revealed':True, 'markedCorrect':True}) == 'unanswered'
    assert score_attempt('Two', {'text':'Two', 'revealed':False, 'markedCorrect':True}) == 'unanswered'
    assert summarize([{'result':'correct'}] + [{'result':'incorrect'}]*7)['accuracy'] == 13
