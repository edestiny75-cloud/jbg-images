from __future__ import annotations

import json
import queue
import shutil
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .. import config
from .. import pipeline as pipeline_mod
from ..claude_client import make_client
from ..ingest import IMAGE_EXT, load_pages, sku_from_path, extract_posters_from_zip
from ..inspect import find_lines_containing
from ..instructions import parse_instructions
from ..models import Finding, FixAttempt, PosterResult
from ..pipeline import run_poster
from ..report import write_summary_xlsx

SKIP_MARKERS = ("_FIXED", "_FINAL", "_NEEDS_HUMAN")
ARCHIVE_DIRNAME = "_archive"
VALID_EXT = IMAGE_EXT | {".pdf"}

INBOX_ROOT = Path(r"C:\Users\Jamsp\OneDrive\Desktop\JBG_QC_INBOX")
JOBS_ROOT = INBOX_ROOT / "jobs"
JOBS_ROOT.mkdir(parents=True, exist_ok=True)

WEB_DIR = Path(__file__).resolve().parent

# In-memory job store. Each job is a plain dict so it round-trips to job.json unchanged;
# see _new_job() for the shape.
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
JOB_QUEUE: "queue.Queue[str]" = queue.Queue()

# Set to the job currently being processed by the worker thread so the monkeypatched
# pipeline.log() knows which job's log list to append to. Processing is strictly
# sequential (one worker), so a single mutable slot is enough.
_CURRENT_JOB_LOG: dict[str, Optional[dict]] = {"job": None}

_worker_started = False
_worker_lock = threading.Lock()


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _skip_name(name: str) -> bool:
    stem = Path(name).stem
    return any(marker in stem for marker in SKIP_MARKERS)


def _patched_log(msg: str) -> None:
    """Replaces poster_qc.pipeline.log while the worker is running: keeps printing to the
    console (as the CLI does) and also appends every line to the current job's log list."""
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", "replace").decode("ascii"), flush=True)
    job = _CURRENT_JOB_LOG["job"]
    if job is not None:
        job["log"].append(msg)


def _save_job(job: dict) -> None:
    path = Path(job["dir"]) / "job.json"
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(job, indent=2), encoding="utf-8")
    except Exception as e:  # noqa: BLE001 - persistence must never crash a QC run
        print(f"[web] failed to save job {job.get('id')}: {type(e).__name__}: {e}", flush=True)


def _new_job(source: str, fix: bool, instructions_text: str, folder_path: Optional[str] = None) -> dict:
    job_id = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:6]
    job_dir = JOBS_ROOT / job_id
    out_dir = job_dir / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    job = {
        "id": job_id,
        "created": _now(),
        "source": source,               # "upload" | "folder" | "apply"
        "parent_job": None,             # set to the source job's id for "apply" (review-mode) jobs
        "folder_path": folder_path,
        "fix": fix,
        "instructions_text": instructions_text,
        "status": "queued",             # queued | running | done | error
        "dir": str(job_dir),
        "out_dir": str(out_dir),
        "posters": [],
        "log": [],
    }
    with JOBS_LOCK:
        JOBS[job_id] = job
    _save_job(job)
    return job


def _in_url(job: dict, path: Path) -> str:
    """URL for a file living under this job's directory (served by the /jobs static mount)."""
    rel = Path(path).relative_to(Path(job["dir"]))
    return f"/jobs/{job['id']}/{rel.as_posix()}"


def _add_poster(job: dict, filepath: Path, filename: str, original_url: Optional[str] = None) -> dict:
    entry = {
        "filename": filename,
        "sku": sku_from_path(filepath),
        "filepath": str(filepath),
        "original_url": original_url,   # servable copy of the pre-fix source, for the original/fixed compare
        "status": "queued",             # queued | running | CLEAN | REVIEW | NEEDS_HUMAN | error
        "result": None,
        "error": None,
    }
    job["posters"].append(entry)
    return entry


def _list_folder_files(folder: Path) -> list[Path]:
    if folder.is_file() and folder.suffix.lower() == ".zip":
        unz = folder.with_name(folder.stem + "_unzipped")
        files = sorted(extract_posters_from_zip(folder, unz))
    else:
        files = sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in VALID_EXT)
    return [p for p in files if not _skip_name(p.name)]


def _result_to_public(job_id: str, sku: str, result_json: dict) -> dict:
    """Rewrite before/after crop paths (and the fixed png / report paths) to URLs served by the
    /jobs static mount, so the dashboard can show them directly."""
    out = dict(result_json)
    crop_base = f"/jobs/{job_id}/out/_work/{sku}/"
    findings = []
    for f in out.get("findings", []):
        f = dict(f)
        attempts = []
        for a in f.get("attempts", []):
            a = dict(a)
            if a.get("before_crop"):
                a["before_crop_url"] = crop_base + a["before_crop"]
            if a.get("after_crop"):
                a["after_crop_url"] = crop_base + a["after_crop"]
            attempts.append(a)
        f["attempts"] = attempts
        findings.append(f)
    out["findings"] = findings
    output_png = out.get("output_png") or ""
    if output_png:
        out["output_url"] = f"/jobs/{job_id}/out/{Path(output_png).name}"
    changes_png = out.get("changes_png") or ""
    if changes_png:
        out["changes_url"] = f"/jobs/{job_id}/out/{Path(changes_png).name}"
    print_pdf = out.get("print_pdf") or ""
    if print_pdf:
        out["print_url"] = f"/jobs/{job_id}/out/{Path(print_pdf).name}"
    out["facts"] = out.get("facts") or []
    out["report_url"] = f"/jobs/{job_id}/out/{sku}_QC.html"
    out["json_url"] = f"/jobs/{job_id}/out/{sku}_QC.json"
    return out


# ---------------------------------------------------------------------------
# worker
# ---------------------------------------------------------------------------

def _process_job(job: dict) -> None:
    job["status"] = "running"
    _save_job(job)
    _CURRENT_JOB_LOG["job"] = job
    known_all = parse_instructions(job["instructions_text"]) if job.get("instructions_text") else {}
    try:
        client = make_client()
    except Exception as e:  # noqa: BLE001
        job["status"] = "error"
        job["log"].append(f"failed to create Claude client: {type(e).__name__}: {e}")
        _save_job(job)
        _CURRENT_JOB_LOG["job"] = None
        return

    out_dir = Path(job["out_dir"])
    results: list[PosterResult] = []
    for poster in job["posters"]:
        poster["status"] = "running"
        job["log"].append(f"== {poster['filename']}")
        _save_job(job)
        try:
            known = known_all.get(poster["sku"])
            override_dicts = poster.get("findings_override")
            findings_override = [Finding.from_dict(d) for d in override_dicts] if override_dicts else None
            res = run_poster(Path(poster["filepath"]), out_dir, client, openai_client=None,
                              known=known, fix=job["fix"], findings_override=findings_override)
            results.append(res)
            result_json = json.loads(res.to_json())
            poster["result"] = _result_to_public(job["id"], poster["sku"], result_json)
            poster["status"] = res.status
            job["log"].append(
                f"   {res.status}  findings={len(res.findings)}  "
                f"fixed={sum(f.status == 'fixed' for f in res.findings)}  -> {res.output_png}")
        except Exception as e:  # noqa: BLE001 - one poster's failure must not stop the queue
            poster["status"] = "error"
            poster["error"] = f"{type(e).__name__}: {e}"
            job["log"].append(f"ERROR processing {poster['filename']}: {poster['error']}")
        _save_job(job)

    if results:
        try:
            write_summary_xlsx(results, out_dir / "QC_Summary.xlsx")
        except Exception as e:  # noqa: BLE001
            job["log"].append(f"failed to write QC_Summary.xlsx: {type(e).__name__}: {e}")

    job["status"] = "done"
    _CURRENT_JOB_LOG["job"] = None
    _save_job(job)


def _worker_loop() -> None:
    while True:
        job_id = JOB_QUEUE.get()
        with JOBS_LOCK:
            job = JOBS.get(job_id)
        if job is None:
            continue
        try:
            _process_job(job)
        except Exception as e:  # noqa: BLE001 - keep the worker thread alive no matter what
            job["status"] = "error"
            job.setdefault("log", []).append(f"job failed: {type(e).__name__}: {e}")
            _save_job(job)
            _CURRENT_JOB_LOG["job"] = None


def _load_jobs_from_disk() -> None:
    if not JOBS_ROOT.exists():
        return
    for job_dir in sorted(JOBS_ROOT.iterdir()):
        if job_dir.name == ARCHIVE_DIRNAME:
            continue                      # archived jobs stay on disk but off the front page
        jf = job_dir / "job.json"
        if not jf.is_file():
            continue
        try:
            job = json.loads(jf.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            print(f"[web] failed to load {jf}: {type(e).__name__}: {e}", flush=True)
            continue
        if job.get("status") in ("running", "queued"):
            job["status"] = "error"
            job.setdefault("log", []).append("interrupted by a dashboard/server restart")
        JOBS[job["id"]] = job


def _ensure_worker_started() -> None:
    global _worker_started
    with _worker_lock:
        if _worker_started:
            return
        _worker_started = True
        pipeline_mod.log = _patched_log
        threading.Thread(target=_worker_loop, daemon=True, name="poster-qc-worker").start()


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    _load_jobs_from_disk()
    _ensure_worker_started()
    yield


app = FastAPI(title="Poster QC Dashboard", lifespan=_lifespan)


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

class FolderJobRequest(BaseModel):
    path: str
    instructions: str = ""
    fix: bool = True


class ApplyChangeItem(BaseModel):
    finding_id: Optional[str] = None
    wrong: str
    right: str
    line_text: Optional[str] = None
    box_name: Optional[str] = None
    bbox: Optional[list[int]] = None
    word_index: Optional[int] = None
    font_style: Optional[str] = None
    text_color: Optional[str] = None


APPROVED_ROOT = INBOX_ROOT / "APPROVED"


def _archive_job(job_id: str) -> str:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    if job.get("status") in ("queued", "running"):
        raise HTTPException(status_code=400, detail="job is still running")
    src = Path(job["dir"])
    dest_root = JOBS_ROOT / ARCHIVE_DIRNAME
    dest_root.mkdir(parents=True, exist_ok=True)
    dest = dest_root / src.name
    if src.exists():
        shutil.move(str(src), str(dest))
    with JOBS_LOCK:
        JOBS.pop(job_id, None)
    return str(dest)


@app.post("/api/jobs/{job_id}/archive")
def archive_job(job_id: str) -> dict:
    """Move a finished job off the front page into jobs/_archive (nothing is deleted)."""
    return {"archived_to": _archive_job(job_id)}


@app.post("/api/jobs/archive_finished")
def archive_finished() -> dict:
    with JOBS_LOCK:
        ids = [j for j, job in JOBS.items() if job.get("status") not in ("queued", "running")]
    moved = [_archive_job(j) for j in ids]
    return {"archived": len(moved), "folder": str(JOBS_ROOT / ARCHIVE_DIRNAME)}


class ApproveRequest(BaseModel):
    dest: str | None = None


@app.post("/api/jobs/{job_id}/posters/{index}/approve")
def approve_poster(job_id: str, index: int, body: ApproveRequest) -> dict:
    """Copy a passed poster's deliverables into a clean per-SKU folder the owner works from."""
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if job is None or index < 0 or index >= len(job.get("posters", [])):
        raise HTTPException(status_code=404, detail="poster not found")
    poster = job["posters"][index]
    res = poster.get("result") or {}
    if poster.get("status") not in ("CLEAN", "REVIEW"):
        raise HTTPException(status_code=400, detail="only PASS/REVIEW posters can be approved")
    sku = poster["sku"]
    out_dir = Path(job["dir"]) / "out"
    dest_root = Path(body.dest) if body.dest else APPROVED_ROOT
    dest = dest_root / sku
    dest.mkdir(parents=True, exist_ok=True)
    copied = []
    pairs = [(res.get("output_png"), f"{sku}.png"), (res.get("print_pdf"), None), (res.get("changes_png"), None),
             (str(out_dir / f"{sku}_QC.html"), None), (str(out_dir / f"{sku}_QC.json"), None)]
    for src, newname in pairs:
        if not src:
            continue
        sp = Path(src)
        if not sp.exists():
            continue
        target = dest / (newname or sp.name)
        shutil.copy2(sp, target)
        copied.append(target.name)
    work = out_dir / "_work" / sku
    if work.exists():
        shutil.copytree(work, dest / "_work" / sku, dirs_exist_ok=True)
    poster["approved_to"] = str(dest)
    _save_job(job)
    return {"dest": str(dest), "files": copied}


class ApplyRequest(BaseModel):
    changes: list[ApplyChangeItem]
    fix: bool = True


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/jobs")
def list_jobs() -> list[dict]:
    with JOBS_LOCK:
        jobs = list(JOBS.values())
    jobs.sort(key=lambda j: j.get("created", ""), reverse=True)
    out = []
    for job in jobs:
        posters = job.get("posters", [])
        counts = {k: 0 for k in ("queued", "running", "CLEAN", "REVIEW", "NEEDS_HUMAN", "REPORT", "error")}
        for p in posters:
            counts[p.get("status", "queued")] = counts.get(p.get("status", "queued"), 0) + 1
        out.append({
            "id": job["id"],
            "created": job["created"],
            "status": job["status"],
            "source": job.get("source"),
            "folder_path": job.get("folder_path"),
            "fix": job.get("fix"),
            "total": len(posters),
            "counts": counts,
            "posters": [{"filename": p["filename"], "sku": p["sku"], "status": p["status"],
                         "error": p.get("error")} for p in posters],
        })
    return out


@app.get("/api/jobs/{job_id}")
def job_detail(job_id: str) -> dict:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@app.post("/api/jobs")
async def create_upload_job(files: list[UploadFile] = File(...), instructions: str = Form(""),
                             fix: str = Form("1")) -> dict:
    fix_bool = fix not in ("0", "false", "False", "")
    job = _new_job(source="upload", fix=fix_bool, instructions_text=instructions or "")
    in_dir = Path(job["dir"]) / "in"
    in_dir.mkdir(parents=True, exist_ok=True)
    saved = 0
    for uf in files:
        name = Path(uf.filename or "").name
        if not name:
            continue
        if Path(name).suffix.lower() == ".zip":
            zdir = in_dir / "_zips"; zdir.mkdir(parents=True, exist_ok=True)
            zpath = zdir / name
            zpath.write_bytes(await uf.read())
            try:
                members = extract_posters_from_zip(zpath, in_dir)
            except Exception as e:  # noqa: BLE001
                job["log"].append(f"could not open {name}: {e}")
                continue
            job["log"].append(f"unpacked {name}: {len(members)} poster file(s)")
            for m in members:
                _add_poster(job, m, m.name, original_url=_in_url(job, m)); saved += 1
            continue
        if Path(name).suffix.lower() not in VALID_EXT:
            job["log"].append(f"skipped {name} (unsupported file type)")
            continue
        if _skip_name(name):
            job["log"].append(f"skipped {name} (already processed)")
            continue
        dest = in_dir / name
        i = 1
        while dest.exists():
            dest = in_dir / f"{Path(name).stem}_{i}{Path(name).suffix}"
            i += 1
        data = await uf.read()
        dest.write_bytes(data)
        _add_poster(job, dest, name, original_url=_in_url(job, dest))
        saved += 1
    if saved == 0:
        with JOBS_LOCK:
            JOBS.pop(job["id"], None)
        raise HTTPException(status_code=400,
                             detail="no image/pdf files to process (all were skipped or unsupported)")
    _save_job(job)
    JOB_QUEUE.put(job["id"])
    return {"job_id": job["id"]}


@app.post("/api/jobs/folder")
def create_folder_job(body: FolderJobRequest) -> dict:
    folder = Path(body.path)
    if not folder.exists() or not (folder.is_dir() or folder.suffix.lower() == ".zip"):
        raise HTTPException(status_code=400, detail=f"folder or zip not found: {body.path}")
    files = _list_folder_files(folder)
    if not files:
        raise HTTPException(status_code=400,
                             detail=f"no image/pdf files to process in {body.path}")
    job = _new_job(source="folder", fix=body.fix, instructions_text=body.instructions or "",
                   folder_path=str(folder))
    in_dir = Path(job["dir"]) / "in"
    in_dir.mkdir(parents=True, exist_ok=True)
    for p in files:
        # Processing still reads from the original folder location (so a big folder is never
        # copied wholesale), but a servable copy lets the dashboard show the original next to
        # the fixed poster even though the source lives outside JOBS_ROOT.
        served = in_dir / p.name
        i = 1
        while served.exists():
            served = in_dir / f"{p.stem}_{i}{p.suffix}"
            i += 1
        original_url = None
        try:
            shutil.copy2(p, served)
            original_url = _in_url(job, served)
        except Exception as e:  # noqa: BLE001 - preview copy is best-effort, never blocks the job
            job["log"].append(f"could not copy {p.name} for preview: {type(e).__name__}: {e}")
        _add_poster(job, p, p.name, original_url=original_url)
    _save_job(job)
    JOB_QUEUE.put(job["id"])
    return {"job_id": job["id"]}


def _stored_finding_to_override(src: dict, wrong: str, right: str) -> Finding:
    """Rebuild a Finding from a poster's already-published result JSON, with the owner's edited
    wrong/right text and a clean attempt history (the previous run's attempts don't apply here;
    _result_to_public also decorates them with *_url keys FixAttempt(**a) can't accept)."""
    d = dict(src)
    d["attempts"] = []
    d["status"] = "open"
    d["wrong"] = wrong or d.get("wrong", "")
    d["right"] = right
    return Finding.from_dict(d)


@app.post("/api/jobs/{job_id}/posters/{index}/apply")
def apply_changes(job_id: str, index: int, body: ApplyRequest) -> dict:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    posters = job.get("posters", [])
    if index < 0 or index >= len(posters):
        raise HTTPException(status_code=404, detail="poster not found")
    if not body.changes:
        raise HTTPException(status_code=400, detail="no changes given")
    poster = posters[index]
    stored_findings = {f["id"]: f for f in (poster.get("result") or {}).get("findings", [])}

    needs_locate = any(not c.finding_id or c.finding_id not in stored_findings for c in body.changes)
    client = None
    if needs_locate:
        try:
            client = make_client()
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"failed to create Claude client: {type(e).__name__}: {e}")

    img = None
    findings: list[Finding] = []
    for change in body.changes:
        src = stored_findings.get(change.finding_id) if change.finding_id else None
        if src is not None:
            findings.append(_stored_finding_to_override(src, change.wrong, change.right))
            continue
        # Owner-added change: nothing stored to copy, so locate the line it's on ourselves.
        if img is None:
            img = load_pages(Path(poster["filepath"]))[0]
        bbox = tuple(change.bbox) if change.bbox else None
        line_text = change.line_text or change.wrong
        word_index = change.word_index if change.word_index is not None else 0
        note = ""
        if bbox is None:
            try:
                lines = find_lines_containing(client, img, change.wrong, model=config.DEFAULT_MODEL)
            except Exception as e:  # noqa: BLE001 - fall through to needs_human below
                lines = []
                note = f"error locating line: {type(e).__name__}: {e}"
            match = next((ln for ln in lines if change.wrong in ln.get("text", "")), lines[0] if lines else None)
            if match:
                bbox = tuple(match["bbox"])
                line_text = match.get("text") or line_text
                toks = line_text.split()
                word_index = toks.index(change.wrong) if change.wrong in toks else 0
            elif not note:
                note = f"could not locate a line containing {change.wrong!r} on the poster"
        f = Finding(id=uuid.uuid4().hex[:8], box_name=change.box_name or "", line_text=line_text,
                    wrong=change.wrong, right=change.right, word_index=word_index,
                    font_style=change.font_style or "plain", kind="spelling", confidence=1.0,
                    text_color=change.text_color or "dark", bbox=bbox or (0, 0, 1, 1), status="open")
        if bbox is None:
            f.status = "needs_human"
            f.attempts.append(FixAttempt(backend="locate", round=0, note=note))
        findings.append(f)

    child = _new_job(source="apply", fix=body.fix, instructions_text="")
    child["parent_job"] = job_id
    in_dir = Path(child["dir"]) / "in"
    in_dir.mkdir(parents=True, exist_ok=True)
    src_path = Path(poster["filepath"])
    dest = in_dir / src_path.name
    original_url = None
    child_filepath = src_path
    try:
        shutil.copy2(src_path, dest)
        child_filepath = dest
        original_url = _in_url(child, dest)
    except Exception as e:  # noqa: BLE001 - fall back to the original path if the copy fails
        child["log"].append(f"could not copy {src_path.name} into the apply job: {type(e).__name__}: {e}")
    entry = _add_poster(child, child_filepath, poster["filename"], original_url=original_url)
    entry["findings_override"] = [f.to_dict() for f in findings]
    _save_job(child)
    JOB_QUEUE.put(child["id"])
    return {"job_id": child["id"]}


app.mount("/jobs", StaticFiles(directory=str(JOBS_ROOT)), name="jobs")
