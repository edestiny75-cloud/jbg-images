import subprocess, sys

def test_cli_help():
    r = subprocess.run([sys.executable, "-m", "poster_qc", "--help"], capture_output=True, text=True,
                       cwd=r"C:\Users\Jamsp\OneDrive\Desktop\Claude Code")
    assert r.returncode == 0 and "run" in r.stdout

def test_cli_run_help_documents_dry_run_alias():
    r = subprocess.run([sys.executable, "-m", "poster_qc", "run", "--help"], capture_output=True, text=True,
                       cwd=r"C:\Users\Jamsp\OneDrive\Desktop\Claude Code")
    assert r.returncode == 0
    assert "--no-fix" in r.stdout and "--dry-run" in r.stdout
