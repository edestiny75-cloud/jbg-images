from poster_qc.models import PosterResult, Finding
from poster_qc.handoff import build_handoff

def test_build_handoff_lists_open_items_for_both_editors():
    res = PosterResult(sku="JBG-POS-LAM-X", source="x.png", width=10, height=10)
    res.findings.append(Finding(id="a", box_name="THE STORY", line_text="Gettysburg, Pennsylvaia,", wrong="Pennsylvaia,", right="Pennsylvania,",
                                word_index=1, font_style="plain", kind="spelling", confidence=0.9, bbox=(0,0,1,1), status="needs_human"))
    res.findings.append(Finding(id="b", box_name="", line_text="fixed one", wrong="one", right="two", word_index=1, font_style="plain",
                                kind="spelling", confidence=0.9, bbox=(0,0,1,1), status="fixed"))
    h = build_handoff(res)
    assert h["count"] == 1
    assert "Pennsylvania," in h["chatgpt"] and "Gettysburg, Pennsylvania," in h["chatgpt"]
    assert "CHANGE THE WORD" in h["higgsfield"] and "\"two\"" not in h["higgsfield"]
    assert build_handoff(PosterResult(sku="s", source="s", width=1, height=1)) == {}
