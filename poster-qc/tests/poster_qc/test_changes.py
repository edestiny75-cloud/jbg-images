import json
from pathlib import Path
from PIL import Image
from tests.poster_qc.synth import line_image
from tests.poster_qc.test_inspect import FakeClient
from poster_qc.pipeline import run_poster


def test_run_poster_writes_changes_png_and_print_pdf_and_facts(tmp_path):
    img, f, _ = line_image("Gettysburg, Pennsylvaia,")
    img.save(tmp_path / "JBG-POS-LAM-Chg_TOFIX.png")
    W, H = img.size
    inspect_reply = json.dumps({
        "findings": [{
            "box_name": "THE STORY", "line_text": "Gettysburg, Pennsylvaia,", "wrong": "Pennsylvaia,",
            "right": "Pennsylvania,", "word_index": 1, "font_style": "plain", "kind": "spelling", "confidence": 0.95,
            "bbox": [0, 0, 1, 1], "tile": 0,
            "box_lines": [{"text": "Gettysburg, Pennsylvaia,", "tile": 0, "bbox": [0, 0, 1, 1]}],
            "box_bbox": [0, 0, 1, 1],
        }],
        "facts_checked": [
            {"claim": "The battle happened at Gettysburg", "box_name": "THE STORY", "verdict": "ok",
             "why": "Gettysburg is correct."},
            {"claim": "It happened in Pennsylvania", "box_name": "THE STORY", "verdict": "ok",
             "why": "Pennsylvania is the correct state."},
        ],
    })
    verify_reply = json.dumps({"reads": "Gettysburg, Pennsylvania,", "matches": True, "artifacts": [], "style_score": 95})
    final_reply = json.dumps({"findings": []})
    client = FakeClient([inspect_reply, "Gettysburg, Pennsylvaia,", "Pennsylvaia,", verify_reply, final_reply])
    res = run_poster(tmp_path / "JBG-POS-LAM-Chg_TOFIX.png", out_dir=tmp_path / "out", client=client,
                     openai_client=None, tile=max(W, H), overlap=0)

    assert res.status == "CLEAN"
    assert res.findings[0].status == "fixed"

    # 1. "what changed" overlay
    changes_path = tmp_path / "out" / "JBG-POS-LAM-Chg_CHANGES.png"
    assert changes_path.exists()
    assert res.changes_png == str(changes_path)
    fixed_path = Path(res.output_png)
    assert fixed_path.exists()
    assert Image.open(changes_path).tobytes() != Image.open(fixed_path).tobytes()
    att = res.findings[0].attempts[0]
    assert att.passed and att.box is not None

    # 2. print PDF
    assert res.print_pdf
    print_pdf_path = Path(res.print_pdf)
    assert print_pdf_path.exists()
    assert print_pdf_path.name == "JBG-POS-LAM-Chg_11x17_Fiery.pdf"

    # 3. facts checked
    assert len(res.facts) == 2
    assert all(fc["verdict"] == "ok" for fc in res.facts)
    assert res.facts[0]["claim"] == "The battle happened at Gettysburg"


def test_run_poster_no_print_pdf_when_needs_human(tmp_path, monkeypatch):
    from poster_qc import config as _cfg
    monkeypatch.setattr(_cfg, "USE_RETYPE", True)
    import poster_qc.config as config
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(config, "get_key", lambda *a, **k: None)
    img, f, _ = line_image("Zylq")
    img.save(tmp_path / "JBG-POS-LAM-NH_TOFIX.png")
    W, H = img.size
    inspect_reply = json.dumps({"findings": [{"box_name": "A", "line_text": "Zylq", "wrong": "Zylq",
        "right": "Bcde", "word_index": 0, "font_style": "script", "kind": "spelling", "confidence": 0.9,
        "bbox": [0, 0, 1, 1], "tile": 0}]})
    find_lines_reply = json.dumps({"lines": []})
    verify_reply = json.dumps({"reads": "Zylq", "matches": False, "artifacts": ["ghost stroke"], "style_score": 20})
    final_reply = json.dumps({"findings": []})
    client = FakeClient([inspect_reply, "Zylq", "Zylq", find_lines_reply, verify_reply, final_reply])
    res = run_poster(tmp_path / "JBG-POS-LAM-NH_TOFIX.png", out_dir=tmp_path / "out_nh", client=client,
                     openai_client=None, tile=max(W, H), overlap=0)
    assert res.status == "NEEDS_HUMAN"
    assert res.print_pdf == ""
    assert res.changes_png == ""


def test_run_poster_make_print_pdf_false_skips_pdf(tmp_path):
    img, f, _ = line_image("Gettysburg, Pennsylvaia,")
    img.save(tmp_path / "JBG-POS-LAM-NoPdf_TOFIX.png")
    W, H = img.size
    inspect_reply = json.dumps({"findings": [{"box_name": "THE STORY", "line_text": "Gettysburg, Pennsylvaia,", "wrong": "Pennsylvaia,",
        "right": "Pennsylvania,", "word_index": 1, "font_style": "plain", "kind": "spelling", "confidence": 0.95,
        "bbox": [0, 0, 1, 1], "tile": 0,
        "box_lines": [{"text": "Gettysburg, Pennsylvaia,", "tile": 0, "bbox": [0, 0, 1, 1]}],
        "box_bbox": [0, 0, 1, 1]}]})
    verify_reply = json.dumps({"reads": "Gettysburg, Pennsylvania,", "matches": True, "artifacts": [], "style_score": 95})
    final_reply = json.dumps({"findings": []})
    client = FakeClient([inspect_reply, "Gettysburg, Pennsylvaia,", "Pennsylvaia,", verify_reply, final_reply])
    res = run_poster(tmp_path / "JBG-POS-LAM-NoPdf_TOFIX.png", out_dir=tmp_path / "out", client=client,
                     openai_client=None, tile=max(W, H), overlap=0, make_print_pdf=False)
    assert res.status == "CLEAN"
    assert res.print_pdf == ""
