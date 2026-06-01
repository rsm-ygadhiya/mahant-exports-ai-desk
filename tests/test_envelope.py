"""Tests for utils/pramukh_common.py (shared envelope + helpers)."""

from __future__ import annotations

from pathlib import Path

from utils.pramukh_common import (
    Envelope, append_rows, already_ran, error_envelope, new_run_id,
)


def test_envelope_to_json_roundtrip():
    env = Envelope(status="ok", skill_name="X", next_action="Y",
                   outputs={"n": 1})
    s = env.to_json()
    assert '"status": "ok"' in s
    assert '"skill_name": "X"' in s
    assert '"next_action": "Y"' in s
    assert '"n": 1' in s


def test_error_envelope_has_error_dict():
    env = error_envelope("foo", "bad_input", "missing X")
    assert env.status == "error"
    assert env.error == {"code": "bad_input", "message": "missing X"}


def test_append_rows_creates_file_with_header(tmp_path: Path):
    p = tmp_path / "out.csv"
    n = append_rows(p, [{"a": 1, "b": 2}, {"a": 3, "b": 4}],
                    fieldnames=["a", "b"])
    assert n == 2
    assert p.read_text().splitlines()[0] == "a,b"


def test_append_rows_appends_without_re_header(tmp_path: Path):
    p = tmp_path / "out.csv"
    append_rows(p, [{"a": 1, "b": 2}], fieldnames=["a", "b"])
    append_rows(p, [{"a": 3, "b": 4}], fieldnames=["a", "b"])
    lines = p.read_text().splitlines()
    # one header + two data rows
    assert len(lines) == 3


def test_already_ran_false_when_file_missing(tmp_path: Path):
    p = tmp_path / "missing.csv"
    assert already_ran(p, "wf-1", "step-1") is False


def test_already_ran_true_after_appending_same_keys(tmp_path: Path):
    p = tmp_path / "out.csv"
    append_rows(p, [{"workflow_run_id": "wf-1", "step_id": "s-1", "x": "y"}],
                fieldnames=["workflow_run_id", "step_id", "x"])
    assert already_ran(p, "wf-1", "s-1") is True
    assert already_ran(p, "wf-2", "s-1") is False


def test_new_run_id_is_prefixed():
    rid = new_run_id()
    assert rid.startswith("wf-")
    assert len(rid) == 15  # 'wf-' + 12 hex chars
