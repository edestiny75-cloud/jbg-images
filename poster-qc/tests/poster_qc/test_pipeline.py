import json
from PIL import Image
from tests.poster_qc.synth import line_image
from tests.poster_qc.test_inspect import FakeClient
from poster_qc.pipeline import run_poster
from poster_qc.models import PosterResult, Finding


def test_run_poster_fixes_plain_word(tmp_path):
    img, f, _ = line_image("Gettysburg, Pennsylvaia,")
    img.save(tmp_path / "JBG-POS-LAM-Test_TOFIX.png")
    W, H = img.size
    inspect_reply = json.dumps({"findings": [{"box_name": "THE STORY", "line_text": "Gettysburg, Pennsylvaia,", "wrong": "Pennsylvaia,",
        "right": "Pennsylvania,", "word_index": 1, "font_style": "plain", "kind": "spelling", "confidence": 0.95,
        "bbox": [0, 0, 1, 1], "tile": 0,
        "box_lines": [{"text": "Gettysburg, Pennsylvaia,", "tile": 0, "bbox": [0, 0, 1, 1]}],
        "box_bbox": [0, 0, 1, 1]}]})
    verify_reply = json.dumps({"reads": "Gettysburg, Pennsylvania,", "matches": True, "artifacts": [], "style_score": 95})
    final_reply = json.dumps({"findings": []})
    client = FakeClient([inspect_reply, "Gettysburg, Pennsylvaia,", "Pennsylvaia,", verify_reply, final_reply])
    res = run_poster(tmp_path / "JBG-POS-LAM-Test_TOFIX.png", out_dir=tmp_path / "out", client=client, openai_client=None, tile=max(W, H), overlap=0)
    assert isinstance(res, PosterResult) and res.status == "CLEAN"
    assert (tmp_path / "out" / "JBG-POS-LAM-Test_FIXED.png").exists()
    # Batch C: glyphclone is tried before retype and the 'n' it needs is already present in the wrong
    # word itself ("Pennsylvaia," -> "Pennsylvania," only needs an inserted 'n'), so it succeeds first.
    assert res.findings[0].attempts[0].backend == "glyphclone" and res.findings[0].status == "fixed"


def test_run_poster_finds_missing_glyph_via_find_lines_containing(tmp_path):
    # "Busk" -> "Bush" needs an 'h', which is absent from the word itself and from every line in its
    # own text box (there's only the one line). A second, unrelated line elsewhere on the poster has a
    # "Bush" the pipeline can locate via find_lines_containing and clone the 'h' from.
    a, fa, _ = line_image("Busk")
    b, fb, _ = line_image("Bush house")
    W = max(a.width, b.width)
    H = a.height + b.height
    img = Image.new("RGB", (W, H), a.getpixel((0, 0)))
    img.paste(a, (0, 0))
    img.paste(b, (0, a.height))
    img.save(tmp_path / "JBG-POS-LAM-Test2_TOFIX.png")

    a_bbox = [0.0, 0.0, 1.0, a.height / H]
    b_bbox = [0.0, a.height / H, 1.0, 1.0]
    inspect_reply = json.dumps({"findings": [{
        "box_name": "A", "line_text": "Busk", "wrong": "Busk", "right": "Bush",
        "word_index": 0, "font_style": "plain", "kind": "spelling", "confidence": 0.9,
        "bbox": a_bbox, "tile": 0,
        "box_lines": [{"text": "Busk", "tile": 0, "bbox": a_bbox}],
        "box_bbox": a_bbox,
    }]})
    find_lines_reply = json.dumps({"lines": [{"text": "Bush house", "tile": 0, "bbox": b_bbox}]})
    verify_reply = json.dumps({"reads": "Bush", "matches": True, "artifacts": [], "style_score": 95})
    final_reply = json.dumps({"findings": []})
    client = FakeClient([inspect_reply, "Busk", "Busk", find_lines_reply, verify_reply, final_reply])

    res = run_poster(tmp_path / "JBG-POS-LAM-Test2_TOFIX.png", out_dir=tmp_path / "out2",
                     client=client, openai_client=None, tile=max(W, H), overlap=0)
    assert res.status == "CLEAN"
    assert res.findings[0].attempts[0].backend == "glyphclone"
    assert res.findings[0].status == "fixed"


def test_run_poster_no_fix_just_inspects(tmp_path):
    img, f, _ = line_image("Gettysburg, Pennsylvaia,")
    img.save(tmp_path / "JBG-POS-LAM-Test3_TOFIX.png")
    W, H = img.size
    inspect_reply = json.dumps({"findings": [{"box_name": "THE STORY", "line_text": "Gettysburg, Pennsylvaia,", "wrong": "Pennsylvaia,",
        "right": "Pennsylvania,", "word_index": 1, "font_style": "plain", "kind": "spelling", "confidence": 0.95,
        "bbox": [0, 0, 1, 1], "tile": 0}]})
    client = FakeClient([inspect_reply])
    res = run_poster(tmp_path / "JBG-POS-LAM-Test3_TOFIX.png", out_dir=tmp_path / "out3", client=client,
                     openai_client=None, fix=False, tile=max(W, H), overlap=0)
    assert res.status == "REPORT"
    assert res.output_png == ""
    assert not (tmp_path / "out3" / "JBG-POS-LAM-Test3_FIXED.png").exists()


def test_run_poster_skips_inpaint_openai_without_key(tmp_path, monkeypatch):
    from poster_qc import config as _cfg
    monkeypatch.setattr(_cfg, 'USE_RETYPE', True)
    # font_style "script" uses BACKENDS_STYLED = [inpaint_openai, glyphclone, retype, higgsfield].
    # There's no OpenAI key and no openai_client, so inpaint_openai must be skipped (never attempted,
    # no API call). "Zylq" -> "Bcde" shares no letters and has no box_lines, so glyphclone can't clone
    # the first missing character even after asking find_lines_containing (which finds nothing) and
    # falls through with an error attempt; retype always succeeds at drawing something but our fake
    # verify reply fails it (low style score); higgsfield is reached last and marks needs_human.
    import poster_qc.config as config
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(config, "get_key", lambda *a, **k: None)
    img, f, _ = line_image("Zylq")
    img.save(tmp_path / "JBG-POS-LAM-Test4_TOFIX.png")
    W, H = img.size
    inspect_reply = json.dumps({"findings": [{"box_name": "A", "line_text": "Zylq", "wrong": "Zylq",
        "right": "Bcde", "word_index": 0, "font_style": "script", "kind": "spelling", "confidence": 0.9,
        "bbox": [0, 0, 1, 1], "tile": 0}]})
    find_lines_reply = json.dumps({"lines": []})
    verify_reply = json.dumps({"reads": "Zylq", "matches": False, "artifacts": ["ghost stroke"], "style_score": 20})
    final_reply = json.dumps({"findings": []})
    client = FakeClient([inspect_reply, "Zylq", "Zylq", find_lines_reply, verify_reply, final_reply])
    res = run_poster(tmp_path / "JBG-POS-LAM-Test4_TOFIX.png", out_dir=tmp_path / "out4", client=client,
                     openai_client=None, tile=max(W, H), overlap=0)
    assert res.status == "NEEDS_HUMAN"
    assert res.findings[0].status == "needs_human"
    backends_tried = [a.backend for a in res.findings[0].attempts]
    assert "inpaint_openai" not in backends_tried
    assert backends_tried == ["glyphclone", "retype", "higgsfield"]
    assert not res.findings[0].attempts[0].passed and not res.findings[0].attempts[1].passed


def test_policy_sends_fact_findings_to_review(tmp_path):
    from tests.poster_qc.synth import line_image
    img, f, _ = line_image("Library of Congress")
    img.save(tmp_path / "JBG-POS-LAM-Fact_TOFIX.png")
    W, H = img.size
    inspect_reply = json.dumps({"findings": [{"box_name": "KEY FACTS", "line_text": "Library of Congress", "wrong": "Congress",
        "right": "House", "word_index": 2, "font_style": "plain", "kind": "fact", "confidence": 0.9,
        "bbox": [0, 0, 1, 1], "tile": 0, "box_lines": [], "box_bbox": [0, 0, 1, 1]}]})
    client = FakeClient([inspect_reply])
    res = run_poster(tmp_path / "JBG-POS-LAM-Fact_TOFIX.png", out_dir=tmp_path / "out", client=client, openai_client=None, tile=max(W, H), overlap=0)
    assert res.findings[0].status == "review" and res.status == "REVIEW"
    assert (tmp_path / "out" / "JBG-POS-LAM-Fact_FIXED.png").exists()
    assert len(client.messages.calls) == 1          # no edit, no verify, no re-inspect needed


def test_run_poster_findings_override_skips_inspect(tmp_path):
    # Review mode: the dashboard already picked/edited the change, so run_poster must skip
    # inspect_poster entirely (no policy re-application either) and run the change straight
    # through the normal locate/fix/verify/re-inspect loop.
    img, f, _ = line_image("Gettysburg, Pennsylvaia,")
    img.save(tmp_path / "JBG-POS-LAM-Override_TOFIX.png")
    W, H = img.size
    finding = Finding(id="ov1", box_name="THE STORY", line_text="Gettysburg, Pennsylvaia,",
                      wrong="Pennsylvaia,", right="Pennsylvania,", word_index=1, font_style="plain",
                      kind="spelling", confidence=1.0, bbox=(0, 0, W, H), status="open",
                      box_lines=[{"text": "Gettysburg, Pennsylvaia,", "tile": 0, "bbox": [0, 0, W, H]}],
                      box_bbox=(0, 0, W, H))
    verify_reply = json.dumps({"reads": "Gettysburg, Pennsylvania,", "matches": True, "artifacts": [], "style_score": 95})
    final_reply = json.dumps({"findings": []})
    # No initial inspect reply at all: inspect_poster must never be called when findings_override is given.
    client = FakeClient(["Gettysburg, Pennsylvaia,", "Pennsylvaia,", verify_reply, final_reply])
    res = run_poster(tmp_path / "JBG-POS-LAM-Override_TOFIX.png", out_dir=tmp_path / "out_override",
                     client=client, openai_client=None, tile=max(W, H), overlap=0,
                     findings_override=[finding])
    assert res.status == "CLEAN"
    assert res.findings[0].attempts[0].backend == "glyphclone"
    assert res.findings[0].attempts[0].passed
    assert res.findings[0].status == "fixed"
    assert not client.messages.replies  # every reply was consumed, nothing extra was asked for
