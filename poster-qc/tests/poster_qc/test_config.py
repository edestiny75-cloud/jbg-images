import os
from poster_qc import config

def test_env_file_parse(tmp_path):
    p = tmp_path / ".env"
    p.write_text('OPENAI_API_KEY="sk-test"\nANTHROPIC_API_KEY=sk-ant-test\n# comment\n', encoding="utf-8")
    d = config.parse_env_file(p)
    assert d == {"OPENAI_API_KEY": "sk-test", "ANTHROPIC_API_KEY": "sk-ant-test"}

def test_get_key_prefers_process_env(monkeypatch, tmp_path):
    monkeypatch.setenv("OPENAI_API_KEY", "from-env")
    assert config.get_key("OPENAI_API_KEY", env_file=tmp_path / "missing.env") == "from-env"

def test_get_key_falls_back_to_env_file(monkeypatch, tmp_path):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    p = tmp_path / ".env"; p.write_text("OPENAI_API_KEY=from-file\n", encoding="utf-8")
    assert config.get_key("OPENAI_API_KEY", env_file=p, use_registry=False) == "from-file"
