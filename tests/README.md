# `tests/`

Every Python function you write needs a test. Same rule as Milestone 02 —
happy path + at least one edge case per function. `uv run pytest` must be
green before you submit.

---

## Layout

Tests **mirror** the source layout:

```
tests/
├── automations/
│   └── test_<name>.py        # one per automation
├── skills/
│   └── test_<name>.py        # one per LLM skill
├── mcp_servers/
│   └── test_<server>.py      # MCP server smoke tests
├── rag/
│   └── test_retrieval.py     # retrieval correctness + empty-result path
├── utils/
│   └── test_<helper>.py      # shared utilities
└── test_orchestrator.py      # end-to-end: at least one full happy-path workflow
```

---

## Run

```bash
uv run pytest                              # full suite
uv run pytest tests/skills                 # just the LLM skills
uv run pytest -k retrieve                  # one pattern
```

`conftest.py` (at the repo root) calls `load_dotenv()` so `TRITONAI_API_KEY`
is available to any test that needs it.

---

## Mocking LLM calls

Tests must run **offline** — no real network calls. The reference repo's
pattern: each LLM skill checks for a mock environment variable before
calling `utils.connect.ask_json()`. In tests, set the variable to the
expected JSON and the skill returns it verbatim instead of hitting the
network.

Reference:

- `customer-ticket-process/skills/check-faq-resolution/scripts/check_faq_resolution.py`
  reads `FAQ_RESOLUTION_MOCK_JSON`.
- `customer-ticket-process/tests/skills/test_check_faq_resolution.py`
  shows how to set it inside a test.

Pick a name like `<YOUR_SKILL>_MOCK_JSON` for each skill that calls the LLM.

If you really want an end-to-end test against TritonAI, mark it
`@pytest.mark.integration` (already configured in `pyproject.toml`) and
run with `uv run pytest -m integration`. The marker keeps these tests off
the default run.

---

## A starter test ships here

`tests/utils/test_connect.py` confirms that `from utils.connect import ask`
imports cleanly. Keep it — it's the quickest way to verify your `.venv` is
set up correctly.
