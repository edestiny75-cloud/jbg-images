from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Literal
import json

BBox = tuple[int, int, int, int]  # x0, y0, x1, y1 in full-image pixels
FontStyle = Literal["plain", "script", "blackletter", "stylized"]
Kind = Literal["spelling", "grammar", "fact", "consistency", "duplicate", "layout", "guardrail"]

@dataclass
class FixAttempt:
    backend: str                      # retype | inpaint_openai | higgsfield
    round: int
    prompt: str = ""
    read_back: str = ""
    style_score: int = 0
    passed: bool = False
    note: str = ""
    before_crop: str = ""             # relative path to png
    after_crop: str = ""
    box: list[int] | None = None      # full-image [x0,y0,x1,y1] the change was made in

@dataclass
class Finding:
    id: str
    box_name: str
    line_text: str
    wrong: str
    right: str
    word_index: int
    font_style: str
    kind: str
    confidence: float
    bbox: BBox                        # coarse region containing the whole line
    status: str = "open"              # open | fixed | needs_human | review | skipped
    text_color: str = "dark"          # dark (ink on paper) | light (white/cream lettering on a dark banner or plate)
    word_box: BBox | None = None      # exact word box after locate
    line_box: BBox | None = None
    box_lines: list = field(default_factory=list)   # every line in the same text box: [{"text","tile","bbox"}]
    box_bbox: BBox | None = None      # the whole text box, full-image coords
    attempts: list[FixAttempt] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Finding":
        d = dict(d)
        d["bbox"] = tuple(d["bbox"])
        if d.get("word_box"): d["word_box"] = tuple(d["word_box"])
        if d.get("line_box"): d["line_box"] = tuple(d["line_box"])
        if d.get("box_bbox"): d["box_bbox"] = tuple(d["box_bbox"])
        d["attempts"] = [FixAttempt(**a) for a in d.get("attempts", [])]
        return cls(**d)

@dataclass
class PosterResult:
    sku: str
    source: str
    width: int
    height: int
    findings: list[Finding] = field(default_factory=list)
    rounds: int = 0
    mode: str = "fix"                 # fix | inspect
    output_png: str = ""
    changes_png: str = ""             # "what changed" overlay, set when >=1 finding was fixed
    print_pdf: str = ""               # Fiery-ready print PDF, set when the poster is print-ready
    facts: list = field(default_factory=list)   # [{"claim","box_name","verdict","why"}, ...] from the first inspection
    notes: list[str] = field(default_factory=list)
    handoff: dict = field(default_factory=dict)
    print_check: dict = field(default_factory=dict)   # detected print size / stretch / dpi   # paste-ready ChatGPT / Higgsfield prompts for open items

    @property
    def status(self) -> str:
        if self.mode == "inspect":
            return "REPORT" if self.findings else "CLEAN"
        if any(f.status in ("open", "needs_human") for f in self.findings):
            return "NEEDS_HUMAN"
        if any(f.status == "review" for f in self.findings):
            return "REVIEW"
        return "CLEAN"

    def to_json(self) -> str:
        d = asdict(self); d["status"] = self.status
        return json.dumps(d, indent=2)
