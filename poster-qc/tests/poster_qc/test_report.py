from PIL import Image
from poster_qc.models import PosterResult, Finding, FixAttempt
from poster_qc.report import write_report, write_summary_xlsx

def test_html_and_xlsx(tmp_path):
    res = PosterResult(sku="JBG-POS-LAM-T", source="t.png", width=10, height=10)
    f = Finding(id="f1", box_name="THE STORY", line_text="a b", wrong="b", right="c", word_index=1, font_style="plain",
                kind="spelling", confidence=0.9, bbox=(0,0,5,5), status="fixed")
    f.attempts.append(FixAttempt(backend="retype", round=1, passed=True, style_score=90, before_crop="x.png", after_crop="y.png"))
    res.findings.append(f)
    write_report(res, tmp_path, Image.new("RGB", (10, 10)))
    html = (tmp_path / "JBG-POS-LAM-T_QC.html").read_text(encoding="utf-8")
    assert "THE STORY" in html and "retype" in html and "CLEAN" in html
    write_summary_xlsx([res], tmp_path / "QC_Summary.xlsx")
    import openpyxl; wb = openpyxl.load_workbook(tmp_path / "QC_Summary.xlsx")
    assert wb.active["A2"].value == "JBG-POS-LAM-T"

def test_html_lists_higgsfield_prompts_for_human_review(tmp_path):
    res = PosterResult(sku="JBG-POS-LAM-H", source="h.png", width=10, height=10)
    f = Finding(id="f2", box_name="THE SEAL", line_text="a b", wrong="b", right="c", word_index=1,
                font_style="script", kind="spelling", confidence=0.9, bbox=(0, 0, 5, 5), status="needs_human")
    f.attempts.append(FixAttempt(backend="inpaint_openai", round=1, passed=False, style_score=50))
    f.attempts.append(FixAttempt(backend="higgsfield", round=1,
                                 prompt='Replace the word "b" with "c" so the line reads exactly: "a c".',
                                 note="run in Higgsfield edit mode via MCP"))
    res.findings.append(f)
    p = write_report(res, tmp_path, Image.new("RGB", (10, 10)))
    html = p.read_text(encoding="utf-8")
    assert "Fix by hand" in html and "ChatGPT prompt" in html
    assert "THE SEAL" in html
    assert "Replace the word" in html and "with" in html and "so the line reads exactly" in html
    assert "NEEDS_HUMAN" in html

def test_html_omits_higgsfield_section_when_no_higgsfield_attempts(tmp_path):
    res = PosterResult(sku="JBG-POS-LAM-N", source="n.png", width=10, height=10)
    p = write_report(res, tmp_path, Image.new("RGB", (10, 10)))
    html = p.read_text(encoding="utf-8")
    assert "Higgsfield prompts" not in html
