"""Install only the adapter's pinned upstream source and isolated dependencies."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / ".runtime" / "source"
REVISION = "6cf793bd868ba5ecbe64722936d4be8fab5a01df"


def run(*args):
    subprocess.run(args, cwd=ROOT, check=True)


def main():
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    if not SOURCE.exists():
        run("git", "clone", "--filter=blob:none", "--no-checkout", "https://github.com/HKUDS/DeepTutor.git", str(SOURCE))
        run("git", "-C", str(SOURCE), "sparse-checkout", "set", "deeptutor")
        run("git", "-C", str(SOURCE), "checkout", "--detach", REVISION)
    current = subprocess.check_output(["git", "-C", str(SOURCE), "rev-parse", "HEAD"], text=True).strip()
    if current != REVISION:
        raise SystemExit("DeepTutor checkout differs from the pinned revision; preserve it and inspect before updating.")
    run("git", "-C", str(SOURCE), "diff", "--exit-code", "HEAD", "--", "deeptutor")
    if not (ROOT / ".runtime" / "venv" / "bin" / "python").exists():
        run("uv", "venv", "--python", sys.executable, str(ROOT / ".runtime" / "venv"))
    run("uv", "pip", "install", "--python", str(ROOT / ".runtime" / "venv" / "bin" / "python"), "-r", "requirements.lock")
    run(str(ROOT / ".runtime" / "venv" / "bin" / "python"), "runner.py", "--check")


if __name__ == "__main__":
    main()
