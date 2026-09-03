from __future__ import annotations
import base64, io
from PIL import Image
from . import config

def backend_choice() -> str:
    """POSTER_QC_BACKEND = claude-code | api | auto (default).
    auto prefers the Claude Code CLI (runs on the owner's subscription, no API credits) when it is
    installed and logged in, and falls back to the API key otherwise."""
    import os
    return (os.environ.get("POSTER_QC_BACKEND") or config.parse_env_file(config.DEFAULT_ENV_FILE).get("POSTER_QC_BACKEND") or "auto").strip().lower()

def make_client(backend: str | None = None):
    from .code_client import CodeClient, cli_logged_in
    choice = (backend or backend_choice())
    if choice == "claude-code":
        print("backend: claude-code (subscription)", flush=True)
        return CodeClient()
    if choice == "auto" and cli_logged_in():
        print("backend: claude-code (subscription)", flush=True)
        return CodeClient()
    import anthropic
    key = config.get_key("ANTHROPIC_API_KEY")
    print("backend: anthropic api (credits)", flush=True)
    return anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()

def image_block(img: Image.Image, max_side: int = 1568) -> dict:
    im = img
    if max(im.size) > max_side:
        s = max_side / max(im.size)
        im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)
    # JPEG keeps requests small (a 4000px poster as PNG tiles blew past the API request limit);
    # quality 88 is visually lossless for reading text
    buf = io.BytesIO(); im.convert("RGB").save(buf, format="JPEG", quality=88, optimize=True)
    return {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                        "data": base64.standard_b64encode(buf.getvalue()).decode()}}

def text_of(msg) -> str:
    return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
