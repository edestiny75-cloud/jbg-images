"""Run the tool's Claude vision calls through the Claude Code CLI (`claude -p`) instead of the API.

Why: the API bills pay-as-you-go credits; the CLI runs on the owner's Claude subscription. The rest of
the package only ever calls `client.messages.create(model=..., max_tokens=..., system=..., messages=[...])`
and reads `.content[i].text`, so this class mimics exactly that surface.

Requirements: `claude` on PATH and logged in once (`claude` then `/login` in a terminal).
"""
from __future__ import annotations
import base64, json, os, shutil, subprocess, tempfile, time
from dataclasses import dataclass
from pathlib import Path

MODEL_ALIAS = {"claude-opus-5": "opus", "claude-sonnet-5": "sonnet", "claude-haiku-4-5": "haiku"}
CLI_TIMEOUT_S = 300


class CodeClientError(RuntimeError):
    pass


@dataclass
class _TextBlock:
    type: str
    text: str


@dataclass
class _Message:
    content: list
    stop_reason: str = "end_turn"


def cli_available() -> bool:
    return shutil.which("claude") is not None


def cli_logged_in() -> bool:
    """Cheap probe: a one-word prompt with no tools. False if not installed or not logged in."""
    if not cli_available():
        return False
    try:
        r = subprocess.run(["claude", "-p", "Reply with OK", "--output-format", "json", "--model", "haiku"],
                           capture_output=True, text=True, timeout=90)
        d = json.loads(r.stdout.strip().splitlines()[-1]) if r.stdout.strip() else {}
        return not d.get("is_error", True)
    except Exception:  # noqa: BLE001
        return False


class _Messages:
    def __init__(self, model_alias: dict[str, str] | None = None, workdir: Path | None = None):
        self.alias = model_alias or MODEL_ALIAS
        self.workdir = Path(workdir or tempfile.mkdtemp(prefix="poster_qc_cli_"))
        self.workdir.mkdir(parents=True, exist_ok=True)
        self.calls: list[dict] = []

    def _materialize(self, content) -> tuple[list[Path], list[str]]:
        """Write image blocks to files; return (paths, text parts) in order."""
        paths, parts = [], []
        if isinstance(content, str):
            return paths, [content]
        for block in content:
            t = block.get("type")
            if t == "text":
                parts.append(block["text"])
            elif t == "image":
                src = block["source"]
                ext = ".jpg" if "jpeg" in src.get("media_type", "") else ".png"
                p = self.workdir / f"img_{len(paths):03d}_{int(time.time() * 1000) % 100000}{ext}"
                p.write_bytes(base64.standard_b64decode(src["data"]))
                paths.append(p)
                parts.append(f"[image file {len(paths)}: {p}]")
        return paths, parts

    def create(self, model: str, max_tokens: int = 4000, system: str | None = None, messages=None, **_):
        messages = messages or []
        all_paths: list[Path] = []
        convo: list[str] = []
        for m in messages:
            paths, parts = self._materialize(m.get("content"))
            all_paths.extend(paths)
            convo.append(f"{m.get('role', 'user').upper()}:\n" + "\n".join(parts))
        prompt = ""
        if system:
            prompt += "INSTRUCTIONS:\n" + system.strip() + "\n\n"
        if all_paths:
            prompt += ("Use the Read tool to open EVERY image file listed below before answering; they are the "
                       "poster images to inspect.\n" + "\n".join(str(p) for p in all_paths) + "\n\n")
        prompt += "\n\n".join(convo)
        prompt += "\n\nAnswer with the final output only, exactly in the format the instructions ask for."
        cmd = ["claude", "-p", prompt, "--allowedTools", "Read", "--output-format", "json",
               "--model", self.alias.get(model, model)]
        self.calls.append({"model": model, "images": len(all_paths)})
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=CLI_TIMEOUT_S, cwd=str(self.workdir),
                           encoding="utf-8", errors="replace")
        out = r.stdout.strip()
        if not out:
            raise CodeClientError(f"claude CLI returned nothing (exit {r.returncode}): {r.stderr[-400:]}")
        try:
            d = json.loads(out.splitlines()[-1])
        except json.JSONDecodeError:
            raise CodeClientError(f"claude CLI output was not JSON: {out[-400:]}")
        if d.get("is_error"):
            raise CodeClientError(f"claude CLI error: {d.get('result')}")
        for p in all_paths:
            try: p.unlink()
            except OSError: pass
        return _Message(content=[_TextBlock("text", str(d.get("result", "")))])


class CodeClient:
    """Drop-in replacement for anthropic.Anthropic() limited to messages.create()."""
    def __init__(self, workdir: Path | None = None):
        self.messages = _Messages(workdir=workdir)
