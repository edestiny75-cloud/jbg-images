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
