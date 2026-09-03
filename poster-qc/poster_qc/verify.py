from __future__ import annotations
from dataclasses import dataclass
import json, re
from PIL import Image
from .claude_client import image_block, text_of
from .tiles import crop_zoom
from .models import BBox
from . import config

@dataclass
class VerifyResult:
    read_back: str
    matches: bool
    style_score: int
    artifacts: list[str]
    passed: bool

PROMPT = """Two zoomed crops of the same poster region: BEFORE the edit and AFTER the edit.
These are tight excerpts: text cut off at the crop edges is expected and must NOT count as an artifact or
lower the score. Judge only the edited word against its immediate neighbours on the same line.
1) Read the AFTER crop's text exactly, character by character.
2) Does the edited line now read exactly: "{expected}"? (matches true/false)
3) List any artifacts in AFTER: ghost strokes, leftover marks, clipped letters, overlapping text, box-shaped color patch.
4) style_score 0-100: how well the edited word matches its neighbours in font family, weight, size, color, baseline alignment.
The AFTER crop must look like nothing was ever edited: same letterforms, stroke weight, size, colour and
background grain as the untouched neighbours. Deduct heavily for any patch that is flatter or smoother than
the surrounding paper.
Output only JSON: {{"reads": str, "matches": bool, "artifacts": [str], "style_score": int}}"""

def verify_fix(client, before: Image.Image, after: Image.Image, box: BBox, expected_line: str,
               model: str = config.VERIFY_MODEL, min_style: int = config.STYLE_GATE_MIN, note: str = "") -> VerifyResult:
    text = PROMPT.format(expected=expected_line)
    if note:
        text += "\nNOTE: " + note
    content = [{"type": "text", "text": "BEFORE:"}, image_block(crop_zoom(before, box)),
               {"type": "text", "text": "AFTER:"}, image_block(crop_zoom(after, box)),
               {"type": "text", "text": text}]
    msg = client.messages.create(model=model, max_tokens=2000, messages=[{"role": "user", "content": content}])
    m = re.search(r"\{.*\}", text_of(msg), re.S)
    d = json.loads(m.group(0)) if m else {}
    score = int(d.get("style_score", 0)); matches = bool(d.get("matches", False)); arts = list(d.get("artifacts", []))
    return VerifyResult(read_back=str(d.get("reads", "")), matches=matches, style_score=score, artifacts=arts,
                        passed=matches and score >= min_style)
