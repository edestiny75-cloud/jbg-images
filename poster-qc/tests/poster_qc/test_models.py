from poster_qc.models import Finding, FixAttempt, PosterResult

def test_finding_roundtrip():
    f = Finding(id="f1", box_name="THE STORY", line_text="Gettysburg, Pennsylvaia,", wrong="Pennsylvaia,",
                right="Pennsylvania,", word_index=1, font_style="plain", kind="spelling",
                confidence=0.98, bbox=(100, 800, 400, 860))
    d = f.to_dict(); g = Finding.from_dict(d)
    assert g == f and g.bbox == (100, 800, 400, 860)

def test_result_status():
    r = PosterResult(sku="JBG-POS-LAM-X", source="x.png", width=10, height=10)
    assert r.status == "CLEAN"
    r.findings.append(Finding(id="a", box_name="", line_text="", wrong="a", right="b", word_index=0,
                              font_style="plain", kind="spelling", confidence=1.0, bbox=(0,0,1,1)))
    assert r.status == "NEEDS_HUMAN"
    r.findings[0].status = "fixed"
    assert r.status == "CLEAN"


def test_result_status_wrong_facts_escalate_to_review():
    r = PosterResult(sku="JBG-POS-LAM-X", source="x.png", width=10, height=10)
    r.facts = [{"claim": "Year was 1863", "box_name": "A", "verdict": "wrong", "why": "It was 1861"}]
    assert r.status == "REVIEW"


def test_result_status_doubtful_facts_escalate_to_review():
    r = PosterResult(sku="JBG-POS-LAM-X", source="x.png", width=10, height=10)
    r.facts = [{"claim": "Population 10k", "box_name": "A", "verdict": "doubtful", "why": "sources disagree"}]
    assert r.status == "REVIEW"


def test_result_status_ok_facts_stay_clean():
    r = PosterResult(sku="JBG-POS-LAM-X", source="x.png", width=10, height=10)
    r.facts = [{"claim": "Gettysburg", "box_name": "A", "verdict": "ok", "why": "correct"}]
    assert r.status == "CLEAN"


def test_result_status_findings_needs_human_wins_over_wrong_facts():
    r = PosterResult(sku="JBG-POS-LAM-X", source="x.png", width=10, height=10)
    r.facts = [{"claim": "x", "box_name": "A", "verdict": "wrong", "why": "y"}]
    r.findings.append(Finding(id="a", box_name="", line_text="", wrong="a", right="b", word_index=0,
                              font_style="plain", kind="spelling", confidence=1.0, bbox=(0,0,1,1),
                              status="needs_human"))
    assert r.status == "NEEDS_HUMAN"


def test_result_status_finding_review_wins_over_ok_facts():
    r = PosterResult(sku="JBG-POS-LAM-X", source="x.png", width=10, height=10)
    r.facts = [{"claim": "x", "box_name": "A", "verdict": "ok", "why": "y"}]
    r.findings.append(Finding(id="a", box_name="", line_text="", wrong="a", right="b", word_index=0,
                              font_style="plain", kind="spelling", confidence=1.0, bbox=(0,0,1,1),
                              status="review"))
    assert r.status == "REVIEW"


def test_inspect_mode_empty_findings_wrong_facts_are_review():
    r = PosterResult(sku="JBG-POS-LAM-X", source="x.png", width=10, height=10, mode="inspect")
    r.facts = [{"claim": "x", "box_name": "A", "verdict": "wrong", "why": "y"}]
    assert r.status == "REVIEW"


def test_inspect_mode_with_findings_stays_report_even_if_facts_wrong():
    r = PosterResult(sku="JBG-POS-LAM-X", source="x.png", width=10, height=10, mode="inspect")
    r.facts = [{"claim": "x", "box_name": "A", "verdict": "wrong", "why": "y"}]
    r.findings.append(Finding(id="a", box_name="", line_text="", wrong="a", right="b", word_index=0,
                              font_style="plain", kind="spelling", confidence=1.0, bbox=(0,0,1,1)))
    assert r.status == "REPORT"


def test_inspect_mode_empty_clean_when_facts_ok():
    r = PosterResult(sku="JBG-POS-LAM-X", source="x.png", width=10, height=10, mode="inspect")
    r.facts = [{"claim": "x", "box_name": "A", "verdict": "ok", "why": "y"}]
    assert r.status == "CLEAN"
