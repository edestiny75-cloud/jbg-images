from __future__ import annotations
import re
from pathlib import Path

_SKU = re.compile(r"(JBG-[A-Z]{3}-[A-Z]{3}-[A-Za-z0-9]+)")
_CHANGE = re.compile(r'change\s+"([^"]+)"\s+to\s+\*{0,2}"([^"]+)"\*{0,2}', re.I)
_ARROW = re.compile(r'"([^"]+)"\s*(?:→|->)\s*\*{0,2}"([^"]+)"\*{0,2}')

def parse_instructions(text: str) -> dict[str, list[tuple[str, str]]]:
    out: dict[str, list[tuple[str, str]]] = {}
    sku = None
    for line in text.splitlines():
        if line.startswith("#"):
            m = _SKU.search(line)
            sku = m.group(1) if m else sku
            continue
        if sku is None: continue
        m = _CHANGE.search(line) or _ARROW.search(line)
        if m:
            out.setdefault(sku, []).append((m.group(1), m.group(2)))
    return out

def load_instructions(path: str | Path) -> dict[str, list[tuple[str, str]]]:
    return parse_instructions(Path(path).read_text(encoding="utf-8"))
