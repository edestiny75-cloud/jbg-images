"""Paste-ready prompts for the two editors the owner uses by hand when a fix needs a human:
ChatGPT (GPT-4o image edit — the method that worked in the civics round) and Higgsfield edit mode.
One prompt per poster, covering every open item, so it is a single paste."""
from __future__ import annotations
from .models import PosterResult, Finding

CHATGPT_PREFIX = ("Edit this poster image. Keep the entire poster identical - same artwork, layout, colors, borders, "
                  "illustrations, and every other word unchanged. Only correct the words listed below, re-lettering each "
                  "directly in place in the exact same font, size, weight, and color as its surroundings so the fix is "
                  "invisible (do NOT add text boxes or patches, do NOT restyle anything). Return the full poster at the same size.")
HIGGSFIELD_PREFIX = ("Keep the same layout, the same artwork, the same colors, the same borders and the same overall poster "
                     "structure. Edit ONLY the text listed below, in place, matching the existing font, size, weight and color:")
HIGGSFIELD_SUFFIX = "ABSOLUTELY NO other changes: no new text, no moved elements, no restyling, same image size."

def _expected_line(f: Finding) -> str:
    toks = f.line_text.split()
    if 0 <= f.word_index < len(toks):
        toks[f.word_index] = f.right
        return " ".join(toks)
    return f.line_text

def open_items(res: PosterResult) -> list[Finding]:
    return [f for f in res.findings if f.status in ("needs_human", "open")]

def build_handoff(res: PosterResult) -> dict:
    items = open_items(res)
    if not items:
        return {}
    cg = [CHATGPT_PREFIX, ""]
    hf = [HIGGSFIELD_PREFIX, ""]
    for f in items:
        where = f"In the {f.box_name} text" if f.box_name else "In the text"
        cg.append(f'- {where}: change "{f.wrong}" to "{f.right}" so the line reads "{_expected_line(f)}".')
        hf.append(f'CHANGE THE WORD "{f.wrong}" TO "{f.right}"' + (f" in the {f.box_name} text" if f.box_name else "")
                  + f' (the line should read: "{_expected_line(f)}")')
    hf += ["", HIGGSFIELD_SUFFIX]
    return {"chatgpt": "\n".join(cg), "higgsfield": "\n".join(hf), "count": len(items),
            "how": "Attach the ORIGINAL image file (not a PDF) to ChatGPT or load it in Higgsfield edit mode, paste the prompt, "
                   "download the result, then drop that result back into the dashboard to verify it."}
