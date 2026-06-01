# `utils/`

Shared helpers used by every skill, automation, and the orchestrator.

This folder ships with **one** helper already wired up:

- **`connect.py`** — `ask()` and `ask_json()` for LLM calls through the
  TritonAI proxy or the optional ChatGPT/Codex OAuth route (same API as
  Milestone 02). All LLM calls in your skills must go through this module —
  no inline `OpenAI()` clients.

  ```python
  from utils.connect import ask, ask_json

  reply = ask("Explain p-values in one sentence.")
  obj = ask_json("Classify this ticket: ...", model="api-llama-4-scout")
  ```

  Switching models is a one-argument change. Cheap models
  (`api-llama-4-scout`, `gemini-3-flash`) for development; pricier models
  (`gpt-5.4`, `claude-opus-4-6-v1`) only when you actually need them. To use
  your own ChatGPT/Codex subscription instead of `TRITONAI_API_KEY`, set
  `model="oauth-gpt"`; the first call opens an OAuth sign-in and caches
  credentials under `~/.oauth_gpt/`.

---

## What you should add

A small **shared infrastructure module** that every skill and automation
imports — without it, each script reinvents argument parsing, CSV
schemas, idempotency, and error handling, and they all drift.

Pick a name that fits your domain (e.g. `case_common.py`, `loan_common.py`,
`<project>_common.py`) and start with these functions, copied/adapted from
`customer-ticket-process/utils/ticketing_common.py`:

| Function | What it does |
| --- | --- |
| `make_skill_parser()` | Builds the standard argparse parser (the CLI flag set from `skills/README.md`). Every skill/automation calls this first. |
| `make_envelope(...)` / `emit_envelope(...)` | Builds and prints the JSON envelope. |
| `emit_error(code, message, ...)` | Emits a uniform error envelope and returns an exit code. Every script's `except` block calls this. |
| `find_step_row(...)` | The idempotency check — has this `(workflow_run_id, step_id)` already produced a row? |
| `append_csv_row(...)` / `replace_step_row(...)` | Schema-stable CSV writes guarded by a POSIX advisory lock. |
| `append_action_log(...)` | Writes one row to `data/working/workflow_action_log.csv` per step. |
| `latest_working_row(...)` | Read the most recent upstream row for a `case_id`. |
| `needs_human_review(...)` | The threshold rule (e.g. `confidence < 0.60` → flag for human). |

Reference: [`customer-ticket-process/utils/ticketing_common.py`](../../customer-ticket-process/utils/ticketing_common.py).
You do **not** need every function. Start with the parser, the envelope,
and the error helper — add the others as you need them.

---

## What this folder is not

- Not a place for project-specific data, schemas, or business logic — those
  belong with the skill or automation that owns them.
- Not a place for "miscellaneous" scripts — those go under `scripts/`.
- Not a place for tests — those mirror source under `tests/utils/`.
