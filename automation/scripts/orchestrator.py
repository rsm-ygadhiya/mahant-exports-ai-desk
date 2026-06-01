"""Pramukh Gems — workflow orchestrator.

Two modes:

1. **CLI mode** (default) — chains the four steps end-to-end as
   subprocesses, prints each step's JSON envelope to stdout. Used by
   ``scripts/scintilla.py``, ``tests/``, and the Mahant Scintilla page.

2. **Web mode** (``--port N``) — serves the basic Orchestrator UI
   required by M03 deliverable §4. Hosts ``scripts/orchestrator_ui.html``
   at ``/`` and exposes a tiny JSON API at ``/api/run-step`` and
   ``/api/reset`` that the front-end calls. No Flask / FastAPI —
   pure stdlib ``http.server``.

Steps::

    1. triage-inventory   (automation)
    2. propose-repricing  (automation, decision-point A)
    3. rank-customer-clv  (automation)
    4. decide-memo        (automation, decision-point B)

All four steps are deterministic Python — no LLM. Each step is
subprocessed with ``--json`` so the orchestrator only reads the JSON
envelope on stdout. The ``next_action`` field on each envelope picks
the next step.

Run::

    uv run python scripts/orchestrator.py                    # CLI: run once
    uv run python scripts/orchestrator.py --today 2026-05-14 # pin date
    uv run python scripts/orchestrator.py --port 8767        # → http://127.0.0.1:8767
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

REPO_ROOT = Path(__file__).resolve().parents[1]

# Insertion order = run order. Each value is the *name* the orchestrator
# uses, and the path to its script.
STEP_SCRIPTS: dict[str, Path] = {
    "triage-inventory":   REPO_ROOT / "automations" / "triage-inventory"   / "scripts" / "triage_inventory.py",
    "propose-repricing":  REPO_ROOT / "automations" / "propose-repricing"  / "scripts" / "propose_repricing.py",
    "rank-customer-clv":  REPO_ROOT / "automations" / "rank-customer-clv"  / "scripts" / "rank_customer_clv.py",
    "decide-memo":        REPO_ROOT / "automations" / "decide-memo"        / "scripts" / "decide_memo.py",
}


def run_step(name: str, script: Path, *,
             run_id: str, case_id: str,
             extra_args: list[str]) -> dict:
    cmd = [
        sys.executable,
        str(script),
        "--json",
        "--workflow-run-id", run_id,
        "--step-id", f"{name}-{run_id[3:11]}",
        "--data-dir", str(REPO_ROOT / "data"),
        "--out-dir",  str(REPO_ROOT / "data" / "working"),
        *extra_args,
    ]
    # Steps use different entity flags — fall back gracefully
    if name in ("triage-inventory", "propose-repricing"):
        cmd += ["--stock-id", case_id]
    elif name == "rank-customer-clv":
        cmd += ["--entity-id", case_id]
    elif name == "decide-memo":
        cmd += ["--memo-id", case_id]

    completed = subprocess.run(
        cmd, capture_output=True, text=True, cwd=str(REPO_ROOT), check=False,
    )
    stdout = (completed.stdout or "").strip()
    if not stdout:
        return {
            "status": "error",
            "error": {"code": "no_output",
                      "message": completed.stderr.strip() or "no stdout"},
            "exit_code": completed.returncode,
        }
    try:
        return json.loads(stdout.splitlines()[-1])
    except json.JSONDecodeError as exc:
        return {
            "status": "error",
            "error": {"code": "invalid_envelope", "message": str(exc)},
            "raw": stdout[-400:],
        }


# ---------------------------------------------------------------------------
# Web-server mode (M03 deliverable §4)
# ---------------------------------------------------------------------------


_UI_HTML = REPO_ROOT / "scripts" / "orchestrator_ui.html"
_WORKING = REPO_ROOT / "data" / "working"
_SIMULATE = REPO_ROOT / "scripts" / "simulate" / "tick.py"

_STEP_ARTIFACT = {
    "triage-inventory":  "triage_decisions.csv",
    "propose-repricing": "repricing_proposals.csv",
    "rank-customer-clv": "clv_tiers.csv",
    "decide-memo":       "memo_decisions.csv",
}


def _read_decisions(name: str) -> list[dict[str, str]]:
    fname = _STEP_ARTIFACT.get(name)
    if not fname:
        return []
    path = _WORKING / fname
    if not path.exists():
        return []
    with path.open() as f:
        return list(csv.DictReader(f))


def _run_single_step(name: str, body: dict) -> dict:
    """Run one step subprocess on behalf of an HTTP caller and return the
    envelope plus the rows of its artifact CSV."""
    script = STEP_SCRIPTS.get(name)
    if script is None:
        return {"error": f"unknown step: {name}"}

    run_id = body.get("run_id") or f"wf-{uuid.uuid4().hex[:12]}"
    extra: list[str] = []
    today = body.get("today")
    if today:
        extra += ["--today", str(today)]
    if name == "propose-repricing" and body.get("thresholdPct") is not None:
        extra += ["--threshold-pct", str(body["thresholdPct"])]
    if name == "decide-memo" and body.get("oppCeiling") is not None:
        extra += ["--opp-ceiling", str(body["oppCeiling"])]
    if name == "decide-memo" and body.get("autoTiers"):
        extra += ["--auto-approve-tiers", str(body["autoTiers"])]

    envelope = run_step(name, script, run_id=run_id,
                        case_id=body.get("caseId", "ALL"), extra_args=extra)
    return {
        "run_id":    run_id,
        "envelope":  envelope,
        "decisions": _read_decisions(name),
        "artifact":  f"working/{_STEP_ARTIFACT.get(name, '')}",
    }


def _run_tick_reset() -> dict:
    """Invoke `scripts/simulate/tick.py --reset` synchronously."""
    if not _SIMULATE.exists():
        return {"ok": False, "error": "simulator not present"}
    proc = subprocess.run(
        [sys.executable, str(_SIMULATE), "--reset"],
        capture_output=True, text=True, cwd=str(REPO_ROOT), check=False,
    )
    if proc.returncode != 0:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-400:]}
    return {"ok": True, "action": "reset to baseline", "message": (proc.stdout or "").strip()}


class _Handler(BaseHTTPRequestHandler):
    """Tiny stdlib HTTP handler — serves the UI + a JSON API."""

    def log_message(self, fmt: str, *args) -> None:  # noqa: D401
        # Quieter than the default access-log; let the orchestrator's
        # own subprocess output be the noisy thing in the terminal.
        sys.stderr.write(f"  http: {fmt % args}\n")

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self, status: int, html: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(html)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(html)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            if _UI_HTML.exists():
                self._send_html(200, _UI_HTML.read_bytes())
            else:
                self._send_html(404, b"<h1>orchestrator_ui.html not found</h1>")
            return
        if parsed.path == "/api/info":
            self._send_json(200, {
                "steps": list(STEP_SCRIPTS.keys()),
                "repo_root": str(REPO_ROOT),
            })
            return
        self._send_json(404, {"error": f"GET {parsed.path} not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            self._send_json(400, {"error": "invalid JSON body"})
            return

        if parsed.path == "/api/run-step":
            qs = parse_qs(parsed.query)
            step = (qs.get("step") or [body.get("step")])[0]
            if not step:
                self._send_json(400, {"error": "missing ?step=NAME"})
                return
            result = _run_single_step(step, body)
            if "error" in result:
                self._send_json(404, result)
                return
            self._send_json(200, result)
            return

        if parsed.path == "/api/reset":
            result = _run_tick_reset()
            status = 200 if result.get("ok") else 500
            self._send_json(status, result)
            return

        self._send_json(404, {"error": f"POST {parsed.path} not found"})


def serve(port: int) -> int:
    """Start the orchestrator UI web server. Blocks until Ctrl-C."""
    if not _UI_HTML.exists():
        print(f"⚠ {_UI_HTML} not found — the UI page won't load.")
    addr = ("127.0.0.1", port)
    srv = ThreadingHTTPServer(addr, _Handler)
    print(f"\n✦ Pramukh Gems Orchestrator UI")
    print(f"  → open http://{addr[0]}:{addr[1]} in your browser")
    print(f"  → ctrl-C to stop\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n  stopped.")
    finally:
        srv.server_close()
    return 0


# ---------------------------------------------------------------------------
# CLI entry
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=None,
                        help="Start the M03 §4 web UI on this port (e.g. 8767). "
                             "Mutually exclusive with the CLI run.")
    parser.add_argument("--case-id", default="ALL",
                        help="Pass through to each step (default 'ALL' = scan).")
    parser.add_argument("--today", default=None,
                        help="ISO date (YYYY-MM-DD); default = today.")
    parser.add_argument("--threshold-pct", type=float, default=None,
                        help="Override propose-repricing |%% change| auto-apply threshold "
                             "(default 7). Decision-point A.")
    parser.add_argument("--opp-ceiling", type=int, default=None,
                        help="Override decide-memo opportunity_score ceiling for "
                             "auto-approve (default 70). Decision-point B.")
    parser.add_argument("--auto-tiers", default=None,
                        help="Comma list of CLV tiers eligible for memo auto-approve "
                             "(default 'Top,High').")
    args = parser.parse_args()

    # Web mode — serve the UI and exit on Ctrl-C
    if args.port is not None:
        return serve(args.port)

    run_id = f"wf-{uuid.uuid4().hex[:12]}"
    print(f"\n🚀 Pramukh Gems Autopilot  ·  workflow_run_id={run_id}", flush=True)
    if args.today:
        print(f"   today (pinned): {args.today}", flush=True)

    review_required_anywhere = False
    for name, script in STEP_SCRIPTS.items():
        # `step-start` / `step-end` markers let a streaming caller
        # (e.g. /api/admin/scintilla/run-stream) push UI updates as each
        # step actually begins and finishes. The plain `--- step: NAME ---`
        # line is kept for backward compatibility with the non-streaming
        # parser.
        print(f"\n--- step-start: {name} ---", flush=True)
        print(f"--- step: {name} ---", flush=True)
        extra: list[str] = []
        if args.today:
            extra += ["--today", args.today]
        if name == "propose-repricing" and args.threshold_pct is not None:
            extra += ["--threshold-pct", str(args.threshold_pct)]
        if name == "decide-memo" and args.opp_ceiling is not None:
            extra += ["--opp-ceiling", str(args.opp_ceiling)]
        if name == "decide-memo" and args.auto_tiers:
            extra += ["--auto-approve-tiers", args.auto_tiers]
        env = run_step(name, script, run_id=run_id,
                       case_id=args.case_id, extra_args=extra)
        print(json.dumps(env, indent=2), flush=True)
        print(f"--- step-end: {name} ---", flush=True)
        if env.get("status") != "ok":
            print(f"❌ step {name} failed — stopping.", flush=True)
            return 1
        if env.get("review_required"):
            review_required_anywhere = True
        if env.get("next_action") in {"done", "closed", None}:
            print(f"\n✅ Workflow finished after {name}.")
            break

    if review_required_anywhere:
        print("\n⚠️  One or more steps need human review. "
              "Look in data/working/ for *_decisions.csv files where "
              "queue='review' or queue='needs_review'.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
