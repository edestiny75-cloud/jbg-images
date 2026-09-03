import io
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from poster_qc.models import Finding, PosterResult
from poster_qc.web import server


def _png_bytes(size=(20, 14)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (240, 240, 200)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def client(tmp_path, monkeypatch):
    """Point the job store at a scratch dir so tests never touch the real JBG_QC_INBOX folder,
    and reset any state left by earlier tests in this process."""
    jobs_root = tmp_path / "jobs"
    jobs_root.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(server, "JOBS_ROOT", jobs_root)
    monkeypatch.setattr(server, "JOBS", {})
    # _process_job always calls make_client() itself (even when run_poster is faked below), and the
    # real make_client() can shell out to probe a "claude" CLI on PATH -- never a real API/subprocess
    # call in tests.
    monkeypatch.setattr(server, "make_client", lambda *a, **k: object())
    with TestClient(server.app) as c:
        yield c


def _wait_for_job(client, job_id, timeout=5.0):
    deadline = time.time() + timeout
    detail = None
    while time.time() < deadline:
        r = client.get(f"/api/jobs/{job_id}")
        assert r.status_code == 200
        detail = r.json()
        if detail["status"] in ("done", "error"):
            return detail
        time.sleep(0.03)
    raise AssertionError(f"job {job_id} did not finish in time: {detail}")


def _fake_run_poster_factory(calls):
    """Stand-in for poster_qc.pipeline.run_poster: writes a *_FIXED.png like the real pipeline
    and returns a clean PosterResult, without calling any Claude/OpenAI APIs."""

    def fake_run_poster(path, out_dir, client_, openai_client=None, known=None, fix=True, **kwargs):
        from poster_qc.ingest import sku_from_path
        from pathlib import Path
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        sku = sku_from_path(path)
        calls.append({"path": str(path), "sku": sku, "known": known, "fix": fix})
        out_png = out_dir / f"{sku}_FIXED.png"
        Image.new("RGB", (20, 14), (255, 255, 255)).save(out_png)
        return PosterResult(sku=sku, source=str(path), width=20, height=14, rounds=1,
                             output_png=str(out_png))

    return fake_run_poster


def test_upload_job_listed_and_detail_shows_clean_poster(client, monkeypatch):
    calls = []
    monkeypatch.setattr(server, "run_poster", _fake_run_poster_factory(calls))

    resp = client.post(
        "/api/jobs",
        files=[("files", ("JBG-POS-LAM-Test.png", _png_bytes(), "image/png"))],
        data={"instructions": "", "fix": "1"},
    )
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["job_id"]

    listing = client.get("/api/jobs").json()
    assert any(j["id"] == job_id for j in listing)

    detail = _wait_for_job(client, job_id)
    assert detail["status"] == "done"
    assert len(detail["posters"]) == 1
    poster = detail["posters"][0]
    assert poster["sku"] == "JBG-POS-LAM-Test"
    assert poster["status"] == "CLEAN"
    assert poster["result"] is not None
    assert poster["result"]["output_url"].endswith("JBG-POS-LAM-Test_FIXED.png")
    assert len(calls) == 1


def test_upload_skips_already_fixed_filenames(client, monkeypatch):
    calls = []
    monkeypatch.setattr(server, "run_poster", _fake_run_poster_factory(calls))

    resp = client.post(
        "/api/jobs",
        files=[
            ("files", ("JBG-POS-LAM-A.png", _png_bytes(), "image/png")),
            ("files", ("JBG-POS-LAM-A_FIXED.png", _png_bytes(), "image/png")),
            ("files", ("JBG-POS-LAM-B_NEEDS_HUMAN.png", _png_bytes(), "image/png")),
            ("files", ("JBG-POS-LAM-C_FINAL.png", _png_bytes(), "image/png")),
        ],
        data={"instructions": "", "fix": "1"},
    )
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["job_id"]

    detail = client.get(f"/api/jobs/{job_id}").json()
    # only the non-marker file should have been queued as a poster to process
    assert [p["filename"] for p in detail["posters"]] == ["JBG-POS-LAM-A.png"]
    assert any("_FIXED" in line or "skipped" in line for line in detail["log"])

    _wait_for_job(client, job_id)
    assert [c["sku"] for c in calls] == ["JBG-POS-LAM-A"]


def test_folder_endpoint_rejects_missing_path(client):
    resp = client.post(
        "/api/jobs/folder",
        json={"path": r"C:\this\path\does\not\exist\jbg_qc_test_missing", "instructions": "", "fix": True},
    )
    assert resp.status_code == 400
    assert "not found" in resp.json()["detail"]


def _fake_run_poster_factory_full(calls):
    """Like _fake_run_poster_factory but also sets changes_png, print_pdf and facts, so the
    server's URL-rewriting (changes_url/print_url) and facts pass-through can be exercised
    without touching any real Claude/OpenAI/print-PDF machinery."""

    def fake_run_poster(path, out_dir, client_, openai_client=None, known=None, fix=True, **kwargs):
        from poster_qc.ingest import sku_from_path
        from pathlib import Path
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        sku = sku_from_path(path)
        calls.append({"path": str(path), "sku": sku, "known": known, "fix": fix})
        out_png = out_dir / f"{sku}_FIXED.png"
        Image.new("RGB", (20, 14), (255, 255, 255)).save(out_png)
        changes_png = out_dir / f"{sku}_CHANGES.png"
        Image.new("RGB", (20, 14), (255, 0, 0)).save(changes_png)
        print_pdf = out_dir / f"{sku}_11x17_Fiery.pdf"
        print_pdf.write_bytes(b"%PDF-1.4\n%fake\n")
        return PosterResult(sku=sku, source=str(path), width=20, height=14, rounds=1,
                             output_png=str(out_png), changes_png=str(changes_png), print_pdf=str(print_pdf),
                             facts=[{"claim": "x", "box_name": "A", "verdict": "ok", "why": "y"}])

    return fake_run_poster


def test_job_detail_exposes_changes_print_and_facts(client, monkeypatch):
    calls = []
    monkeypatch.setattr(server, "run_poster", _fake_run_poster_factory_full(calls))

    resp = client.post(
        "/api/jobs",
        files=[("files", ("JBG-POS-LAM-Full.png", _png_bytes(), "image/png"))],
        data={"instructions": "", "fix": "1"},
    )
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["job_id"]

    detail = _wait_for_job(client, job_id)
    poster = detail["posters"][0]
    assert poster["original_url"] is not None and poster["original_url"].endswith("JBG-POS-LAM-Full.png")
    result = poster["result"]
    assert result["changes_url"].endswith("JBG-POS-LAM-Full_CHANGES.png")
    assert result["print_url"].endswith("JBG-POS-LAM-Full_11x17_Fiery.pdf")
    assert result["facts"] == [{"claim": "x", "box_name": "A", "verdict": "ok", "why": "y"}]


def _fake_run_poster_factory_capture(calls, with_finding=False):
    """Captures every kwarg run_poster was called with (in particular findings_override, so the
    apply-endpoint test can verify exactly what the "review mode" changes turned into), and
    optionally seeds the result with one Finding an apply request can reference by id."""

    def fake_run_poster(path, out_dir, client_, openai_client=None, known=None, fix=True, **kwargs):
        from poster_qc.ingest import sku_from_path
        from pathlib import Path
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        sku = sku_from_path(path)
        calls.append({"path": str(path), "sku": sku, "known": known, "fix": fix,
                      "findings_override": kwargs.get("findings_override")})
        out_png = out_dir / f"{sku}_FIXED.png"
        Image.new("RGB", (20, 14), (255, 255, 255)).save(out_png)
        res = PosterResult(sku=sku, source=str(path), width=20, height=14, rounds=1, output_png=str(out_png))
        if with_finding:
            res.findings.append(Finding(id="f1", box_name="THE STORY", line_text="Foo bar", wrong="Foo",
                                        right="Foolish", word_index=0, font_style="plain", kind="spelling",
                                        confidence=0.9, bbox=(0, 0, 10, 10), status="review"))
        return res

    return fake_run_poster


def test_apply_endpoint_creates_child_job_with_override_findings(client, monkeypatch):
    calls = []
    monkeypatch.setattr(server, "run_poster", _fake_run_poster_factory_capture(calls, with_finding=True))

    resp = client.post(
        "/api/jobs",
        files=[("files", ("JBG-POS-LAM-Apply.png", _png_bytes(), "image/png"))],
        data={"instructions": "", "fix": "1"},
    )
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["job_id"]
    _wait_for_job(client, job_id)

    apply_resp = client.post(
        f"/api/jobs/{job_id}/posters/0/apply",
        json={"changes": [{"finding_id": "f1", "wrong": "Foo", "right": "Foobar"}], "fix": True},
    )
    assert apply_resp.status_code == 200, apply_resp.text
    child_id = apply_resp.json()["job_id"]
    assert child_id != job_id

    child_detail = _wait_for_job(client, child_id)
    assert child_detail["parent_job"] == job_id
    assert child_detail["source"] == "apply"
    assert child_detail["posters"][0]["sku"] == "JBG-POS-LAM-Apply"

    override_calls = [c for c in calls if c["findings_override"] is not None]
    assert len(override_calls) == 1
    override = override_calls[0]["findings_override"]
    assert len(override) == 1
    assert override[0].id == "f1"
    assert override[0].wrong == "Foo"
    assert override[0].right == "Foobar"
    assert override[0].status == "open"


def test_apply_endpoint_rejects_unknown_poster_index(client, monkeypatch):
    calls = []
    monkeypatch.setattr(server, "run_poster", _fake_run_poster_factory_capture(calls, with_finding=True))
    resp = client.post(
        "/api/jobs",
        files=[("files", ("JBG-POS-LAM-Bad.png", _png_bytes(), "image/png"))],
        data={"instructions": "", "fix": "1"},
    )
    job_id = resp.json()["job_id"]
    _wait_for_job(client, job_id)
    bad = client.post(
        f"/api/jobs/{job_id}/posters/5/apply",
        json={"changes": [{"finding_id": "f1", "wrong": "Foo", "right": "Foobar"}], "fix": True},
    )
    assert bad.status_code == 404


def test_instructions_text_is_parsed_and_passed_as_known(client, monkeypatch):
    calls = []
    monkeypatch.setattr(server, "run_poster", _fake_run_poster_factory(calls))

    instructions = (
        '# JBG-POS-LAM-Test\n'
        'Change "Pennsylvaia" to "Pennsylvania"\n'
    )
    resp = client.post(
        "/api/jobs",
        files=[("files", ("JBG-POS-LAM-Test.png", _png_bytes(), "image/png"))],
        data={"instructions": instructions, "fix": "1"},
    )
    assert resp.status_code == 200, resp.text
    job_id = resp.json()["job_id"]
    _wait_for_job(client, job_id)

    assert len(calls) == 1
    assert calls[0]["known"] == [("Pennsylvaia", "Pennsylvania")]
