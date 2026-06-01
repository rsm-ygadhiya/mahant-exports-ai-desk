# `scripts/`

This is where your **orchestrator** lives — the driver that runs your
skills and automations in sequence, passing each step's JSON envelope to
the next. Glue scripts (data generation, suite reports, etc.) also live
here.

`orchestrator.py` ships as a minimal stub so the layout is obvious; replace
it with your real driver.

---

## What "orchestrator" means

The orchestrator is **not a skill**. It's plain Python — boring, testable,
predictable — that:

1. Decides the run identifier (`workflow_run_id`).
2. Sets up an isolated `data/working/` for the run.
3. Subprocesses each step with the standard CLI flags (see
   [`../skills/README.md`](../skills/README.md)).
4. Reads the JSON envelope from stdout.
5. Reads `envelope["next_action"]` to choose the next step (or pauses for
   human input).
6. Stops when the workflow reports a terminal `next_action` (e.g.
   `done`, `closed`).

Keep the control flow here. The model decides *within* skills; the
orchestrator decides *between* skills.

---

## Two routes for M03

| Route | Effort | What graders see |
| --- | --- | --- |
| **CLI driver** | ~100 lines | Run `uv run python scripts/orchestrator.py --case-id CASE-00042` and the workflow runs end-to-end, printing each step's envelope. **Required minimum.** |
| **Web testing tool** | More work | A small HTTP server + HTML page that lets a user pick an example case, step forward one skill at a time, and see what data went in / came out at each step. **Strongly encouraged for the demo video.** |

The web route is exactly what `customer-ticket-process/scripts/orchestrator.py`
does (a single 1.6 KB Python file + an HTML template). Read it
end-to-end before designing yours; you do not need to copy all of its
features (branch visualisation, idempotency UI, scenario suite) — pick the
2–3 that best showcase your workflow.

---

## The stub in this folder

`orchestrator.py` here:

- Defines an empty `STEP_SCRIPTS` dict you fill in.
- Has a `run_step(name, case_id, run_id)` helper that subprocesses a step
  with `--json` and parses the envelope.
- Has a `main()` that walks `STEP_SCRIPTS` in insertion order until a
  step returns `next_action="done"` or `STEP_SCRIPTS` is exhausted.
- Prints each envelope so you can see the run.

Run it to confirm it works (it will report "no steps registered yet"):

```bash
uv run python scripts/orchestrator.py
```

When you add a real step, register it like this:

```python
STEP_SCRIPTS["classify-case"] = (
    REPO_ROOT / "automations" / "classify-case" / "scripts" / "classify_case.py"
)
```

---

## Things you will probably need (when you get there)

- An **isolated run folder** under `/tmp` so demo runs don't pollute
  `data/working/`. See `customer-ticket-process/scripts/orchestrator.py`
  for the `tempfile.mkdtemp` pattern.
- **Human-in-the-loop pauses**, e.g. waiting for the user to type
  customer feedback before resuming. Same reference repo: the
  `verify-feedback-close-or-reopen` step pauses.
- A **scenario suite**: a list of synthetic example cases that exercise
  every branch of your workflow. The reference repo's
  `automations/summarize-workflow-suite/` is the model.
