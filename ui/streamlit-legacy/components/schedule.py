"""macOS launchd schedule manager for the daily Autopilot run.

The UI calls ``enable(hour, minute)`` to install + load the launchd job, and
``disable()`` to unload + remove it. The plist lives at
``~/Library/LaunchAgents/com.pramukh.autopilot.plist``.

``build_plist_dict`` is broken out as a pure function so the structure is
unit-testable without touching the filesystem or running ``launchctl``.
"""

from __future__ import annotations

import os
import platform
import plistlib
import shutil
import subprocess
import sys
from pathlib import Path

LABEL = "com.pramukh.autopilot"
_PLIST_DIR = Path.home() / "Library" / "LaunchAgents"
_PLIST_PATH = _PLIST_DIR / f"{LABEL}.plist"


# ---------------------------------------------------------------------------
# Path / binary discovery
# ---------------------------------------------------------------------------


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _uv_path() -> str:
    """Best-effort lookup for the ``uv`` binary.

    `launchd` runs with a minimal PATH, so we need the absolute path.
    """
    found = shutil.which("uv")
    if found:
        return found
    candidates = [
        Path.home() / ".local" / "bin" / "uv",
        Path("/opt/homebrew/bin/uv"),
        Path("/usr/local/bin/uv"),
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return "uv"  # last-resort; will fail at runtime if uv truly missing


# ---------------------------------------------------------------------------
# Pure plist builder (unit-testable)
# ---------------------------------------------------------------------------


def build_plist_dict(hour: int, minute: int,
                     repo_root: Path, uv_bin: str) -> dict:
    """Return the launchd plist dictionary for the daily Autopilot job."""
    if not (0 <= hour <= 23):
        raise ValueError(f"hour must be 0-23, got {hour}")
    if not (0 <= minute <= 59):
        raise ValueError(f"minute must be 0-59, got {minute}")

    log_dir = repo_root / "data" / "Milestone_2"
    return {
        "Label": LABEL,
        "ProgramArguments": [
            uv_bin, "run", "python", "-m", "app.autopilot_daily",
        ],
        "WorkingDirectory": str(repo_root),
        "StartCalendarInterval": {"Hour": int(hour), "Minute": int(minute)},
        "StandardOutPath": str(log_dir / "autopilot_cron.log"),
        "StandardErrorPath": str(log_dir / "autopilot_cron.err"),
        "EnvironmentVariables": {
            "PATH": (
                f"{os.path.dirname(uv_bin)}:/opt/homebrew/bin:"
                "/usr/local/bin:/usr/bin:/bin"
            ),
        },
        "RunAtLoad": False,
    }


# ---------------------------------------------------------------------------
# State inspection
# ---------------------------------------------------------------------------


def is_supported() -> bool:
    return platform.system() == "Darwin"


def is_installed() -> bool:
    return _PLIST_PATH.exists()


def current_schedule() -> tuple[int, int] | None:
    """Return (hour, minute) of the configured run, or None if not installed."""
    if not _PLIST_PATH.exists():
        return None
    try:
        with _PLIST_PATH.open("rb") as f:
            d = plistlib.load(f)
    except Exception:
        return None
    cal = d.get("StartCalendarInterval") or {}
    if isinstance(cal, dict) and "Hour" in cal and "Minute" in cal:
        return int(cal["Hour"]), int(cal["Minute"])
    return None


def plist_path() -> Path:
    return _PLIST_PATH


# ---------------------------------------------------------------------------
# Enable / disable
# ---------------------------------------------------------------------------


def _launchctl(action: str, path: Path, check: bool = False) -> tuple[int, str]:
    """Run a launchctl command and return (exit_code, combined_output)."""
    res = subprocess.run(
        ["launchctl", action, str(path)],
        capture_output=True, text=True, check=False,
    )
    if check and res.returncode != 0:
        raise RuntimeError(
            f"launchctl {action} failed (exit {res.returncode}): "
            f"{res.stdout}{res.stderr}"
        )
    return res.returncode, (res.stdout + res.stderr).strip()


def enable(hour: int, minute: int) -> Path:
    """Install (or update) the plist and load it into launchd."""
    if not is_supported():
        raise RuntimeError("Scheduling is only supported on macOS.")

    _PLIST_DIR.mkdir(parents=True, exist_ok=True)
    plist = build_plist_dict(hour, minute, _repo_root(), _uv_path())

    # If already installed, unload first so the change takes effect.
    if _PLIST_PATH.exists():
        _launchctl("unload", _PLIST_PATH)

    with _PLIST_PATH.open("wb") as f:
        plistlib.dump(plist, f)

    _launchctl("load", _PLIST_PATH, check=True)
    return _PLIST_PATH


def disable() -> None:
    """Unload and remove the launchd job."""
    if not is_supported():
        return
    if _PLIST_PATH.exists():
        _launchctl("unload", _PLIST_PATH)
        _PLIST_PATH.unlink()


# ---------------------------------------------------------------------------
# CLI for manual testing
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(f"installed: {is_installed()}, schedule: {current_schedule()}")
    elif args[0] == "enable" and len(args) == 3:
        p = enable(int(args[1]), int(args[2]))
        print(f"Enabled at {args[1]}:{args[2].zfill(2)} — plist at {p}")
    elif args[0] == "disable":
        disable()
        print("Disabled.")
    else:
        print("Usage: schedule.py [enable HOUR MINUTE | disable]")
        sys.exit(2)
