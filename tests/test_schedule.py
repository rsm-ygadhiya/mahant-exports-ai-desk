"""Tests for app/components/schedule.py.

The plist builder is pure and fully unit-tested. `enable` / `disable` are thin
wrappers over ``launchctl`` + filesystem ops; we only assert that
``build_plist_dict`` produces the right structure (the wrappers are exercised
by hand on macOS).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.components import schedule


def test_build_plist_dict_minimal_shape(tmp_path: Path):
    plist = schedule.build_plist_dict(
        hour=8, minute=30,
        repo_root=tmp_path,
        uv_bin="/Users/lucifer/.local/bin/uv",
    )
    assert plist["Label"] == "com.pramukh.autopilot"
    assert plist["WorkingDirectory"] == str(tmp_path)
    assert plist["ProgramArguments"] == [
        "/Users/lucifer/.local/bin/uv",
        "run", "python", "-m", "app.autopilot_daily",
    ]
    assert plist["StartCalendarInterval"] == {"Hour": 8, "Minute": 30}
    assert plist["RunAtLoad"] is False


def test_build_plist_dict_log_paths_under_repo(tmp_path: Path):
    plist = schedule.build_plist_dict(0, 0, tmp_path, "/usr/local/bin/uv")
    log = Path(plist["StandardOutPath"])
    err = Path(plist["StandardErrorPath"])
    assert log.parent == tmp_path / "data" / "Milestone_2"
    assert log.name == "autopilot_cron.log"
    assert err.name == "autopilot_cron.err"


def test_build_plist_dict_includes_uv_dir_in_path(tmp_path: Path):
    plist = schedule.build_plist_dict(12, 0, tmp_path, "/opt/homebrew/bin/uv")
    assert "/opt/homebrew/bin:" in plist["EnvironmentVariables"]["PATH"]


def test_build_plist_dict_rejects_bad_hour(tmp_path: Path):
    with pytest.raises(ValueError):
        schedule.build_plist_dict(24, 0, tmp_path, "/usr/bin/uv")
    with pytest.raises(ValueError):
        schedule.build_plist_dict(-1, 0, tmp_path, "/usr/bin/uv")


def test_build_plist_dict_rejects_bad_minute(tmp_path: Path):
    with pytest.raises(ValueError):
        schedule.build_plist_dict(8, 60, tmp_path, "/usr/bin/uv")
    with pytest.raises(ValueError):
        schedule.build_plist_dict(8, -1, tmp_path, "/usr/bin/uv")


def test_is_supported_matches_platform(monkeypatch):
    import platform as platform_mod
    monkeypatch.setattr(platform_mod, "system", lambda: "Darwin")
    # is_supported reads platform.system at call time
    assert schedule.is_supported() is True
    monkeypatch.setattr(platform_mod, "system", lambda: "Linux")
    assert schedule.is_supported() is False
