import json
from PIL import Image
from poster_qc.verify import verify_fix
from tests.poster_qc.test_inspect import FakeClient

def test_verify_fix_parses_scores():
    img = Image.new("RGB", (300, 300), "white")
    reply = json.dumps({"reads": "Gettysburg, Pennsylvania,", "matches": True, "artifacts": [], "style_score": 92})
    r = verify_fix(FakeClient([reply]), before=img, after=img, box=(50, 50, 150, 80), expected_line="Gettysburg, Pennsylvania,", model="m")
    assert r.passed and r.style_score == 92 and r.read_back.endswith("Pennsylvania,")

def test_verify_fails_on_low_style():
    img = Image.new("RGB", (300, 300), "white")
    reply = json.dumps({"reads": "Gettysburg, Pennsylvania,", "matches": True, "artifacts": ["ghost stroke"], "style_score": 60})
    r = verify_fix(FakeClient([reply]), img, img, (50, 50, 150, 80), "Gettysburg, Pennsylvania,", model="m")
    assert not r.passed
    reply = json.dumps({"reads": "Gettysburg, Pennsylvania,", "matches": True, "artifacts": ["very slight smoothing"], "style_score": 91})
    r = verify_fix(FakeClient([reply]), img, img, (50, 50, 150, 80), "Gettysburg, Pennsylvania,", model="m")
    assert r.passed and r.artifacts == ["very slight smoothing"]
