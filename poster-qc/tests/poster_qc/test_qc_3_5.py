"""Deferred #3–5: re-inspect known, fact→spelling promote, locate punctuation hardening."""
import json
from poster_qc.models import Finding
from poster_qc.pipeline import (
    _looks_like_spelling,
    _with_printed_punct,
    _normalize_index,
    _token_core,
    _policy,
    run_poster,
)
from tests.poster_qc.synth import line_image
from tests.poster_qc.test_inspect import FakeClient


def test_looks_like_spelling_promotes_typos_not_fact_swaps():
    assert _looks_like_spelling("Mississipi", "Mississippi") is True
    assert _looks_like_spelling("Pennsylvaia", "Pennsylvania") is True
    assert _looks_like_spelling("Congress", "House") is False
    assert _looks_like_spelling("COASTLINE", "OCEAN") is False
    assert _looks_like_spelling("same", "same") is False


def test_with_printed_punct_adopts_trailing_comma():
    assert _with_printed_punct("Pennsylvaia", "Pennsylvaia,") == "Pennsylvaia,"
    assert _with_printed_punct("Pennsylvania", "Pennsylvaia,") == "Pennsylvania,"
    assert _with_printed_punct("done.", "done.") == "done."
    assert _token_core("Hello,") == "Hello"


def test_normalize_index_syncs_punctuation_without_substring_trap():
    # Claude quoted without comma; line token has comma; index was wrong (0).
    f = Finding(
        id="1", box_name="A", line_text="Gettysburg, Pennsylvaia, next",
        wrong="Pennsylvaia", right="Pennsylvania", word_index=0,
        font_style="plain", kind="spelling", confidence=0.9, bbox=(0, 0, 1, 1),
    )
    _normalize_index(f)
    assert f.word_index == 1
    assert f.wrong == "Pennsylvaia,"
    assert f.right == "Pennsylvania,"
    # Substring trap: core 'art' must NOT match 'artifact'
    f2 = Finding(
        id="2", box_name="A", line_text="an artifact here",
        wrong="art", right="arts", word_index=0,
        font_style="plain", kind="spelling", confidence=0.9, bbox=(0, 0, 1, 1),
    )
    _normalize_index(f2)
    # no core-equal token → leave index alone (and don't rewrite wrong/right from artifact)
    assert f2.word_index == 0
    assert f2.wrong == "art"


def test_policy_promotes_fact_typo_keeps_real_fact_as_review():
    typo = Finding(
        id="t", box_name="A", line_text="Mississipi River",
        wrong="Mississipi", right="Mississippi", word_index=0,
        font_style="plain", kind="fact", confidence=0.9, bbox=(0, 0, 1, 1),
    )
    _policy(typo)
    assert typo.kind == "spelling"
    assert typo.status == "open"

    real = Finding(
        id="r", box_name="A", line_text="Library of Congress",
        wrong="Congress", right="House", word_index=2,
        font_style="plain", kind="fact", confidence=0.9, bbox=(0, 0, 1, 1),
    )
    _policy(real)
    assert real.kind == "fact"
    assert real.status == "review"


def test_policy_known_fact_becomes_spelling():
    f = Finding(
        id="k", box_name="A", line_text="Francis Scott Ray",
        wrong="Ray", right="Key", word_index=2,
        font_style="plain", kind="fact", confidence=0.5, bbox=(0, 0, 1, 1),
    )
    _policy(f, known=[("Francis Scott Ray", "Francis Scott Key")])
    assert f.kind == "spelling"
    assert f.status == "open"
    assert f.confidence >= 0.99


def test_reinspect_passes_known_errors(tmp_path):
    """#3: after a fix round, re-inspect must still receive the known-error list."""
    img, _, _ = line_image("Gettysburg, Pennsylvaia,")
    img.save(tmp_path / "JBG-POS-LAM-KnownRI_TOFIX.png")
    W, H = img.size
    inspect_reply = json.dumps({"findings": [{
        "box_name": "THE STORY", "line_text": "Gettysburg, Pennsylvaia,",
        "wrong": "Pennsylvaia,", "right": "Pennsylvania,", "word_index": 1,
        "font_style": "plain", "kind": "spelling", "confidence": 0.95,
        "bbox": [0, 0, 1, 1], "tile": 0,
        "box_lines": [{"text": "Gettysburg, Pennsylvaia,", "tile": 0, "bbox": [0, 0, 1, 1]}],
        "box_bbox": [0, 0, 1, 1],
    }]})
    verify_reply = json.dumps({"reads": "Gettysburg, Pennsylvania,", "matches": True, "artifacts": [], "style_score": 95})
    # Re-inspect returns empty, but the call must still include KNOWN ERRORS text.
    final_reply = json.dumps({"findings": []})
    client = FakeClient([inspect_reply, "Gettysburg, Pennsylvaia,", "Pennsylvaia,", verify_reply, final_reply])
    known = [("Pennsylvaia", "Pennsylvania")]
    res = run_poster(
        tmp_path / "JBG-POS-LAM-KnownRI_TOFIX.png",
        out_dir=tmp_path / "out_ri",
        client=client,
        openai_client=None,
        known=known,
        tile=max(W, H),
        overlap=0,
    )
    assert res.findings[0].status == "fixed"
    # Last Claude call is the re-inspect; it must include the known-error prompt text.
    last = client.messages.calls[-1]
    blob = str(last)
    assert "KNOWN ERRORS" in blob
    assert "Pennsylvaia" in blob
