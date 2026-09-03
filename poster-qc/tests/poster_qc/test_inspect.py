import json
from PIL import Image
from poster_qc.inspect import inspect_poster, parse_findings_json, find_lines_containing

class FakeMsg:
    def __init__(self, text): self.content = [type("B", (), {"type": "text", "text": text})()]; self.stop_reason = "end_turn"
class FakeMessages:
    def __init__(self, replies): self.replies = list(replies); self.calls = []
    def create(self, **kw): self.calls.append(kw); return FakeMsg(self.replies.pop(0))
class FakeClient:
    def __init__(self, replies): self.messages = FakeMessages(replies)

def test_parse_findings_json_tolerates_fence():
    txt = 'here\n```json\n{"findings":[{"box_name":"A","line_text":"x y","wrong":"y","right":"z","word_index":1,"font_style":"plain","kind":"spelling","confidence":0.9,"bbox":[0.1,0.2,0.9,0.3],"tile":0}]}\n```'
    d = parse_findings_json(txt); assert d["findings"][0]["wrong"] == "y"

def test_inspect_maps_tile_bbox_to_full():
    img = Image.new("RGB", (1000, 1000), "white")
    reply = json.dumps({"findings": [{"box_name": "THE STORY", "line_text": "Gettysburg, Pennsylvaia,", "wrong": "Pennsylvaia,",
        "right": "Pennsylvania,", "word_index": 1, "font_style": "plain", "kind": "spelling", "confidence": 0.95,
        "bbox": [0.0, 0.0, 0.5, 0.1], "tile": 0}]})
    client = FakeClient([reply])
    findings = inspect_poster(client, img, known=[("Pennsylvaia", "Pennsylvania")], model="m", tile=1000, overlap=0)
    assert len(findings) == 1 and findings[0].bbox == (0, 0, 500, 100)
    assert "Pennsylvaia" in client.messages.calls[0]["messages"][0]["content"][-1]["text"]

def test_inspect_maps_box_lines_and_box_bbox_to_full():
    img = Image.new("RGB", (1000, 1000), "white")
    reply = json.dumps({"findings": [{"box_name": "THE STORY", "line_text": "Gettysburg, Pennsylvaia,", "wrong": "Pennsylvaia,",
        "right": "Pennsylvania,", "word_index": 1, "font_style": "plain", "kind": "spelling", "confidence": 0.95,
        "bbox": [0.0, 0.0, 0.5, 0.1], "tile": 0,
        "box_lines": [
            {"text": "Gettysburg, Pennsylvaia,", "tile": 0, "bbox": [0.0, 0.0, 0.5, 0.1]},
            {"text": "to dedicate a portion", "tile": 0, "bbox": [0.0, 0.1, 0.4, 0.2]},
        ],
        "box_bbox": [0.0, 0.0, 0.6, 0.3]}]})
    client = FakeClient([reply])
    findings = inspect_poster(client, img, model="m", tile=1000, overlap=0)
    f = findings[0]
    assert f.box_bbox == (0, 0, 600, 300)
    assert f.box_lines[0]["bbox"] == [0, 0, 500, 100]
    assert f.box_lines[1]["bbox"] == [0, 100, 400, 200]
    assert f.box_lines[1]["text"] == "to dedicate a portion"

def test_find_lines_containing_maps_bbox_and_sends_needle():
    img = Image.new("RGB", (1000, 1000), "white")
    reply = json.dumps({"lines": [{"text": "Bush house on the hill", "tile": 0, "bbox": [0.0, 0.0, 0.5, 0.1]}]})
    client = FakeClient([reply])
    lines = find_lines_containing(client, img, "Bush", model="m", tile=1000, overlap=0)
    assert lines == [{"text": "Bush house on the hill", "bbox": [0, 0, 500, 100]}]
    assert "Bush" in client.messages.calls[0]["messages"][0]["content"][-1]["text"]

def test_find_lines_containing_empty_when_no_match():
    img = Image.new("RGB", (1000, 1000), "white")
    reply = json.dumps({"lines": []})
    client = FakeClient([reply])
    assert find_lines_containing(client, img, "Zzzyx", model="m", tile=1000, overlap=0) == []
