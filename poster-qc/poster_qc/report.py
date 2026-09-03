from __future__ import annotations
from pathlib import Path
from html import escape
from urllib.parse import quote
from .models import PosterResult

CSS = """body{font-family:Segoe UI,Arial,sans-serif;background:#FFF8E7;color:#2B2B2B;margin:0;padding:24px}
h1{color:#5B3FA0}.pill{display:inline-block;padding:2px 10px;border-radius:12px;font-weight:600}
.CLEAN{background:#C8F0D8;color:#116633}.REVIEW{background:#FFF1C2;color:#7A5A00}.REPORT{background:#DCE8FF;color:#1F3F8F}.NEEDS_HUMAN{background:#FFD6D6;color:#8B0000}
table{border-collapse:collapse;width:100%;background:#fff;margin-bottom:24px}th,td{border:1px solid #E6D9F5;padding:6px;font-size:14px;vertical-align:top}
th{background:#EADCF8}.crops img{max-width:420px;border:1px solid #ccc;margin:4px}.ok{color:#116633}.bad{color:#8B0000}
.hf{background:#fff;border:1px solid #E6D9F5;border-radius:8px;padding:10px;margin:8px 0}
.hf code{display:block;white-space:pre-wrap;background:#FFF8E7;padding:8px;border-radius:6px;margin-top:6px}
.top-actions{margin:10px 0 20px}
.btn{display:inline-block;background:#5B3FA0;color:#fff;text-decoration:none;padding:8px 16px;border-radius:8px;font-weight:600;font-size:13px;margin-right:10px}
.btn:hover{background:#472F80}
.changes-shot{max-width:100%;border:1px solid #ccc;border-radius:6px;display:block;margin:10px 0}
.change-item{background:#fff;border:1px solid #E6D9F5;border-radius:8px;padding:10px;margin:8px 0}
.fp{display:inline-block;padding:2px 10px;border-radius:12px;font-weight:700;color:#fff;font-size:12px}
.fp-ok{background:#1f7a4d}.fp-doubtful{background:#b9822a}.fp-wrong{background:#b03a3a}
.facts-summary{font-size:14px;color:#555;margin:4px 0 10px}
.two-up{display:flex;gap:16px;margin:10px 0}.two-up-col{flex:1;min-width:0}
.two-up-label{font-weight:700;color:#5B3FA0;margin-bottom:4px;font-size:13px}
.two-up img{width:100%;border:1px solid #ccc;border-radius:6px;display:block}"""

def _attempts_html(res: PosterResult, f) -> str:
    att_html = ""
    for a in f.attempts:
        cls = "ok" if a.passed else "bad"
        crops = ""
        if a.before_crop or a.after_crop:
            w = f"_work/{res.sku}/"
            crops = f'<div class="crops"><img src="{w}{a.before_crop}"><img src="{w}{a.after_crop}"></div>'
        att_html += (f'<div class="{cls}">r{a.round} <b>{escape(a.backend)}</b> style={a.style_score} '
                     f'{"PASS" if a.passed else "FAIL"} {escape(a.note)}<br><small>{escape(a.prompt)}</small>{crops}</div>')
    return att_html

def _print_check_html(res: PosterResult) -> str:
    pc = res.print_check or {}
    if not pc:
        return ""
    color = "#1f7a4d" if pc.get("ok") and pc.get("dpi", 0) >= 150 else "#b9822a"
    return (f"<h2>Print check</h2><p style='padding:10px 14px;border-radius:10px;background:{color}22;border-left:6px solid {color}'>"
            f"<b>{escape(str(pc.get('size', '?')))} {escape(str(pc.get('orientation', '')))}</b> &middot; "
            f"{escape(str(pc.get('note', '')))}</p>")

def _higgsfield_section(res: PosterResult) -> str:
    from .handoff import build_handoff
    h = res.handoff or build_handoff(res)
    if not h:
        return ""
    def box(title, key):
        return (f"<div class='hf'><div style='display:flex;justify-content:space-between;align-items:center'><b>{title}</b>"
                f"<button onclick=\"navigator.clipboard.writeText(document.getElementById('{key}').innerText);this.textContent='Copied';\" "
                f"style='font-size:12px;font-weight:600;padding:6px 12px;border-radius:8px;border:0;background:#3a2e5c;color:#fff;cursor:pointer'>Copy</button></div>"
                f"<code id='{key}' style='white-space:pre-wrap;display:block;margin-top:6px'>{escape(h[key])}</code></div>")
    return (f"<h2>Fix by hand — {h['count']} item(s)</h2><p>{escape(h['how'])}</p>"
            + box("ChatGPT prompt (GPT-4o image edit — the method that worked)", "chatgpt")
            + box("Higgsfield edit-mode prompt", "higgsfield"))

def _top_actions_html(res: PosterResult) -> str:
    links = []
    if res.output_png:
        links.append(f'<a class="btn" href="{escape(Path(res.output_png).name)}">Download fixed PNG</a>')
    if res.print_pdf:
        links.append(f'<a class="btn" href="{escape(Path(res.print_pdf).name)}">Download print PDF</a>')
    if res.changes_png:
        links.append(f'<a class="btn" href="{escape(Path(res.changes_png).name)}" target="_blank">What changed</a>')
    if not links:
        return ""
    return f'<div class="top-actions">{"".join(links)}</div>'

def _changes_section(res: PosterResult, original_name: str = "") -> str:
    if not res.changes_png:
        return ""
    name = escape(Path(res.changes_png).name)
    parts = [f'<h2>What changed</h2>']
    if original_name:
        oname = escape(original_name)
        parts.append(
            '<div class="two-up">'
            f'<div class="two-up-col"><div class="two-up-label">Original</div>'
            f'<a href="{oname}" target="_blank"><img src="{oname}" alt="original"></a></div>'
            f'<div class="two-up-col"><div class="two-up-label">Fixed</div>'
            f'<a href="{name}" target="_blank"><img src="{name}" alt="fixed, changes outlined"></a></div>'
            '</div>')
    else:
        parts.append(f'<a href="{name}" target="_blank"><img class="changes-shot" src="{name}" alt="what changed"></a>')
    for f in res.findings:
        if f.status != "fixed":
            continue
        att = next((a for a in f.attempts if a.passed), None)
        if att is None:
            continue
        crops = ""
        if att.before_crop or att.after_crop:
            w = f"_work/{res.sku}/"
            crops = f'<div class="crops"><img src="{w}{att.before_crop}"><img src="{w}{att.after_crop}"></div>'
        box_txt = f" &nbsp; <small>box={escape(str(att.box))}</small>" if att.box else ""
        parts.append(f'<div class="change-item"><b>{escape(f.box_name)}</b> &mdash; '
                     f'{escape(f.wrong)} &rarr; {escape(f.right)}{box_txt}{crops}</div>')
    return "".join(parts)

def _facts_section(res: PosterResult) -> str:
    facts = res.facts or []
    if not facts:
        return ""
    ok = sum(1 for x in facts if x.get("verdict") == "ok")
    doubtful = sum(1 for x in facts if x.get("verdict") == "doubtful")
    wrong = sum(1 for x in facts if x.get("verdict") == "wrong")
    bits = [f"{len(facts)} facts checked", f"{ok} OK"]
    if doubtful:
        bits.append(f"{doubtful} doubtful")
    if wrong:
        bits.append(f"{wrong} wrong")
    summary = " &middot; ".join(bits)
    rows = []
    for x in facts:
        verdict = x.get("verdict", "doubtful")
        cls = {"ok": "fp-ok", "doubtful": "fp-doubtful", "wrong": "fp-wrong"}.get(verdict, "fp-doubtful")
        rows.append(f"<tr><td>{escape(x.get('claim', ''))}</td><td>{escape(x.get('box_name', ''))}</td>"
                    f"<td><span class='fp {cls}'>{escape(verdict.upper())}</span></td>"
                    f"<td>{escape(x.get('why', ''))}</td></tr>")
    return (f"<h2>Facts checked</h2><div class='facts-summary'>{summary}</div>"
            f"<table><tr><th>Claim</th><th>Where</th><th>Verdict</th><th>Why</th></tr>{''.join(rows)}</table>")

def write_report(res: PosterResult, out_dir: str | Path, img=None, original_img=None) -> Path:
    out_dir = Path(out_dir)
    (out_dir / f"{res.sku}_QC.json").write_text(res.to_json(), encoding="utf-8")
    original_name = ""
    if original_img is not None and res.changes_png:
        original_name = f"{res.sku}_ORIGINAL.png"
        try:
            original_img.save(out_dir / original_name)
        except Exception:  # noqa: BLE001 - the report must still write even if this fails
            original_name = ""
    rows = []
    for f in res.findings:
        rows.append(f"<tr><td>{escape(f.box_name)}</td><td>{escape(f.kind)}</td><td>{escape(f.wrong)}</td>"
                    f"<td>{escape(f.right)}</td><td>{escape(f.line_text)}</td><td>{f.confidence:.2f}</td>"
                    f"<td>{escape(f.status)}</td><td>{_attempts_html(res, f)}</td></tr>")
    html = f"""<!doctype html><meta charset="utf-8"><title>{escape(res.sku)} QC</title><style>{CSS}</style>
<a href="http://127.0.0.1:8765/#poster={quote(res.sku)}" style="display:inline-block;margin-bottom:10px;text-decoration:none;font-size:14px;font-weight:700;padding:10px 16px;border-radius:9px;background:#3a2e5c;color:#fff">&larr; Back to dashboard</a>
<h1>Jelly Bean Genius — Poster QC</h1><p><b>{escape(res.sku)}</b> &nbsp; <span class="pill {res.status}">{res.status}</span>
&nbsp; {res.width}×{res.height}px &nbsp; rounds={res.rounds} &nbsp; source: {escape(res.source)}</p>
{_top_actions_html(res)}
{_changes_section(res, original_name)}
<h2>Findings</h2>
<table><tr><th>Box</th><th>Kind</th><th>Found</th><th>Should be</th><th>Line</th><th>Conf</th><th>Status</th><th>Attempts (before / after)</th></tr>
{''.join(rows) or '<tr><td colspan=8>No findings</td></tr>'}</table>
{_facts_section(res)}
{_print_check_html(res)}
{_higgsfield_section(res)}
<p>{'<br>'.join(escape(n) for n in res.notes)}</p>"""
    p = out_dir / f"{res.sku}_QC.html"; p.write_text(html, encoding="utf-8"); return p

def write_summary_xlsx(results: list[PosterResult], path: str | Path) -> Path:
    import openpyxl
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "QC"
    ws.append(["SKU", "Status", "Findings", "Fixed", "Needs human", "Rounds", "Output", "Source"])
    for r in results:
        ws.append([r.sku, r.status, len(r.findings), sum(f.status == "fixed" for f in r.findings),
                   sum(f.status in ("open", "needs_human") for f in r.findings), r.rounds, r.output_png, r.source])
    wb.save(path); return Path(path)
