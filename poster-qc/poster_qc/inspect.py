from __future__ import annotations
import json, re, uuid
from PIL import Image
from .claude_client import image_block, text_of
from .tiles import grid_tiles, to_full
from .models import Finding
from . import config

SYSTEM = """You are a print-proofreader for Jelly Bean Genius (JBG) educational posters for children 3-14.
You read every word on the poster image and its zoomed tiles, then report every error.
Check: spelling, grammar, punctuation, factual accuracy (dates, names, numbers, quotes) against general
knowledge, internal consistency (same name spelled two ways), duplicated text, text cut off at the edge,
and JBG guardrail phrasing (no clinical medical instructions, no 'save a life' language).
Be exact: quote the wrong token exactly as printed, including attached punctuation; give the corrected token
with the same attached punctuation. word_index is the 0-based index of the token in line_text.split().
font_style: plain (normal serif/sans body text), script (cursive), blackletter (gothic), stylized (painted/wood/chart labels).
text_color: "dark" when the lettering is darker than its background (ink on paper), "light" when the lettering is
lighter than its background (white/cream text on a dark banner, plaque or ribbon).
For every finding also report every other line that shares the same text box (heading, caption, or paragraph
the wrong line sits inside) as box_lines, and box_bbox for the whole text box.
Separately, list EVERY factual statement on the poster as facts_checked: every date, name, number,
attribution and quote, and every "who did what" claim — not just the ones that are wrong. For each give a
verdict: "wrong" when the poster states something false or attributes something to the wrong person/place,
"doubtful" when you are unsure or it is arguable, "ok" when it checks out. Give a one-sentence reason in
plain English a parent or teacher (not a subject expert) can understand.
Output only JSON: {"findings":[{"box_name":str,"line_text":str,"wrong":str,"right":str,"word_index":int,
"font_style":str,"text_color":"dark|light","kind":"spelling|grammar|fact|consistency|duplicate|layout|guardrail","confidence":0-1,
"tile":int,"bbox":[x0,y0,x1,y1 normalized 0-1 within that tile, covering the WHOLE LINE],
"box_lines":[{"text":str,"tile":int,"bbox":[x0,y0,x1,y1 normalized 0-1 within that tile]}, ...],
"box_bbox":[x0,y0,x1,y1 normalized 0-1 within the finding's tile, covering the WHOLE TEXT BOX]}],
"facts_checked":[{"claim":str,"box_name":str,"verdict":"ok|doubtful|wrong","why":str}]}.
Inside JSON strings escape every double quote as \\" (poster text often contains quotations).
If the poster is clean, output {"findings":[],"facts_checked":[]}."""

def parse_findings_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text, re.S)
    if not m: return {"findings": []}
    raw = m.group(0)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    # cheap repairs: smart quotes, trailing commas
    fixed = raw.replace('“', '\\"').replace('”', '\\"').replace('’', "'")
    fixed = re.sub(r',\s*([}\]])', r'\1', fixed)
    return json.loads(fixed)

def _ask_json(client, model: str, system: str, content: list, max_tokens: int = 16000) -> dict:
    """Send the request; if the reply is not valid JSON, ask once for a corrected copy."""
    msg = client.messages.create(model=model, max_tokens=max_tokens, system=system,
                                 messages=[{"role": "user", "content": content}])
    text = text_of(msg)
    try:
        return parse_findings_json(text)
    except json.JSONDecodeError as e:
        retry = client.messages.create(model=model, max_tokens=max_tokens, system=system, messages=[
            {"role": "user", "content": content},
            {"role": "assistant", "content": text},
            {"role": "user", "content": f"That JSON is invalid ({e}). Output the same findings again as strictly valid JSON only, "
                                        f"escaping every double quote inside strings as \\\". No prose."}])
        return parse_findings_json(text_of(retry))

def inspect_poster(client, img: Image.Image, known: list[tuple[str, str]] | None = None,
                   model: str = config.DEFAULT_MODEL, tile: int = 900, overlap: int = 120,
                   facts_out: list | None = None) -> list[Finding]:
    tiles = grid_tiles(img, tile=tile, overlap=overlap)
    content = [{"type": "text", "text": "FULL POSTER (for context):"}, image_block(img)]
    for t in tiles:
        content.append({"type": "text", "text": f"TILE {t.index} covers full-image box {t.box}:"})
        content.append(image_block(t.image))
    known_txt = ""
    if known:
        known_txt = "KNOWN ERRORS that MUST be located and reported (wrong -> right):\n" + \
                    "\n".join(f'- "{w}" -> "{r}"' for w, r in known) + "\n"
    content.append({"type": "text", "text": known_txt + "Report every error on this poster as JSON. Reference the tile where the line is most legible."})
    data = _ask_json(client, model, SYSTEM, content)
    out: list[Finding] = []
    for f in data.get("findings", []):
        t = tiles[int(f.get("tile", 0)) % len(tiles)]
        bbox = to_full(t, tuple(float(v) for v in f["bbox"]))
        box_bbox = None
        if f.get("box_bbox"):
            box_bbox = to_full(t, tuple(float(v) for v in f["box_bbox"]))
        box_lines = []
        for bl in f.get("box_lines", []) or []:
            bt = tiles[int(bl.get("tile", f.get("tile", 0))) % len(tiles)]
            bl_bbox = to_full(bt, tuple(float(v) for v in bl["bbox"]))
            box_lines.append({"text": bl.get("text", ""), "tile": bt.index, "bbox": list(bl_bbox)})
        out.append(Finding(id=uuid.uuid4().hex[:8], box_name=f.get("box_name", ""), line_text=f["line_text"],
                           wrong=f["wrong"], right=f["right"], word_index=int(f.get("word_index", 0)),
                           font_style=f.get("font_style", "plain"), kind=f.get("kind", "spelling"),
                           text_color=("light" if str(f.get("text_color", "dark")).lower().startswith("l") else "dark"),
                           confidence=float(f.get("confidence", 0.5)), bbox=bbox,
                           box_lines=box_lines, box_bbox=box_bbox))
    if facts_out is not None:
        for fc in data.get("facts_checked", []) or []:
            facts_out.append({"claim": fc.get("claim", ""), "box_name": fc.get("box_name", ""),
                              "verdict": fc.get("verdict", "doubtful"), "why": fc.get("why", "")})
    return out

def find_lines_containing(client, img: Image.Image, needle: str, model: str = config.DEFAULT_MODEL,
                          tile: int = 900, overlap: int = 120) -> list[dict]:
    """One vision call: find every line anywhere on the poster (not just the finding's own text box)
    that contains the exact word `needle` (correctly spelled), for extending a GlyphLibrary when a
    needed character isn't available locally. Returns [{"text": str, "bbox": [full-image x0,y0,x1,y1]}]."""
    tiles = grid_tiles(img, tile=tile, overlap=overlap)
    content = [{"type": "text", "text": "FULL POSTER (for context):"}, image_block(img)]
    for t in tiles:
        content.append({"type": "text", "text": f"TILE {t.index} covers full-image box {t.box}:"})
        content.append(image_block(t.image))
    content.append({"type": "text", "text":
        f'Find every line of text anywhere on this poster (in any box) that contains the exact word '
        f'"{needle}" spelled correctly, as printed. Output only JSON: {{"lines":[{{"text":str,"tile":int,'
        f'"bbox":[x0,y0,x1,y1 normalized 0-1 within that tile, covering the WHOLE LINE]}}]}}. '
        f'If there are none, output {{"lines":[]}}.'})
    msg = client.messages.create(model=model, max_tokens=4000, messages=[{"role": "user", "content": content}])
    m = re.search(r"\{.*\}", text_of(msg), re.S)
    data = json.loads(m.group(0)) if m else {"lines": []}
    out: list[dict] = []
    for ln in data.get("lines", []) or []:
        t = tiles[int(ln.get("tile", 0)) % len(tiles)]
        bbox = to_full(t, tuple(float(v) for v in ln["bbox"]))
        out.append({"text": ln.get("text", ""), "bbox": list(bbox)})
    return out


def read_line(client, img: Image.Image, box, model: str = config.DEFAULT_MODEL, pad: int = 6) -> str:
    """Transcribe one line (or one word) of poster text exactly; used to confirm the locator's choice."""
    from .tiles import crop_zoom
    content = [image_block(crop_zoom(img, box, pad=pad, scale=4)),
               {"type": "text", "text": "Transcribe ALL text visible in this image exactly as printed, one line of the "
                                        "image per output line, including punctuation and any misspelling. Do not correct "
                                        "anything. Output only the text, nothing else."}]
    msg = client.messages.create(model=model, max_tokens=300, messages=[{"role": "user", "content": content}])
    return text_of(msg).strip().strip('`"')
