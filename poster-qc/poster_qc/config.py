from __future__ import annotations
import os, sys
from pathlib import Path

PKG_DIR = Path(__file__).resolve().parent
DEFAULT_ENV_FILE = PKG_DIR / ".env"
DEFAULT_MODEL = "claude-opus-5"
VERIFY_MODEL = "claude-opus-5"
OPENAI_IMAGE_MODEL = "gpt-image-2"
OPENAI_IMAGE_MODEL_FALLBACK = "gpt-image-1"
STYLE_GATE_MIN = 85
STYLE_GATE_MIN_CONDENSED = 75   # when the word had to be condensed to fit a flush line
MAX_ROUNDS = 3
PRINT_SIZE_IN = (11, 17)        # (short, long) inches; orientation chosen per-poster from image aspect
PRINT_DPI = 300
MAKE_PRINT_PDF = True
FALLBACK_ENV_FILES = [Path(r"C:\Users\Jamsp\OneDrive\Desktop\Claude Code\ai-diary\.env")]

def parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not Path(path).exists():
        return out
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out

def _registry_user_env(name: str) -> str | None:
    if not sys.platform.startswith("win"):
        return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
            val, _ = winreg.QueryValueEx(k, name)
            return str(val) or None
    except OSError:
        return None

def get_key(name: str, env_file: Path = DEFAULT_ENV_FILE, use_registry: bool = True) -> str | None:
    if os.environ.get(name):
        return os.environ[name]
    for f in [env_file, *FALLBACK_ENV_FILES]:
        v = parse_env_file(f).get(name)
        if v:
            return v
    return _registry_user_env(name) if use_registry else None

# Auto-fix policy. Only these kinds are edited automatically; everything else (facts, guardrails,
# layout, duplicates) is reported for a human. Findings below the confidence floor are reported too.
AUTO_FIX_KINDS = {"spelling", "consistency", "grammar"}
AUTO_FIX_MIN_CONFIDENCE = 0.6
USE_RETYPE = False          # font-substitution retype almost never passes the style gate on AI posters
REGION_PAD_Y = 0.6          # expand Claude's (often clipped) line box by this fraction of its height, top and bottom
REGION_PAD_X = 8
NOTE_MIN_CONFIDENCE = 0.5   # findings below this are listed as skipped, never block a poster
