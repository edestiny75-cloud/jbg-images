import json
from PIL import Image
from poster_qc.code_client import CodeClient
from poster_qc.claude_client import image_block


def test_code_client_materializes_images_and_returns_text(monkeypatch, tmp_path):
    seen = {}
    def fake_run(cmd, **kw):
        seen["cmd"] = cmd
        class R: stdout = json.dumps({"type": "result", "is_error": False, "result": "Gettysburg, Pennsylvaia,"}); stderr = ""; returncode = 0
        return R()
    monkeypatch.setattr("poster_qc.code_client.subprocess.run", fake_run)
    c = CodeClient(workdir=tmp_path)
    img = Image.new("RGB", (40, 20), "white")
    msg = c.messages.create(model="claude-opus-5", max_tokens=100, system="Be exact.",
                            messages=[{"role": "user", "content": [image_block(img), {"type": "text", "text": "Transcribe."}]}])
    assert msg.content[0].text == "Gettysburg, Pennsylvaia,"
    prompt = seen["cmd"][2]
    assert "Be exact." in prompt and "Transcribe." in prompt and "img_000" in prompt
    assert "--allowedTools" in seen["cmd"] and "opus" in seen["cmd"]


def test_code_client_raises_on_cli_error(monkeypatch, tmp_path):
    def fake_run(cmd, **kw):
        class R: stdout = json.dumps({"is_error": True, "result": "Not logged in"}); stderr = ""; returncode = 1
        return R()
    monkeypatch.setattr("poster_qc.code_client.subprocess.run", fake_run)
    import pytest
    from poster_qc.code_client import CodeClientError
    with pytest.raises(CodeClientError):
        CodeClient(workdir=tmp_path).messages.create(model="claude-opus-5", messages=[{"role": "user", "content": "hi"}])
