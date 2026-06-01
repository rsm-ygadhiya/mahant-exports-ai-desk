# MGT 449 · Group 10 — Final Project

Everything for the class in one place, organised by **function** rather than by
milestone. The Mahant Exports app is the product UI; the skills, automations,
RAG, and MCP servers are the engine behind it.

## Layout

| Folder | What's inside |
|---|---|
| `ui/` | The product. Mahant Exports **web** app (`web/`, Next.js + Prisma) and **mobile** app (`mobile/`, Flutter). `ui/streamlit-legacy/` is the earlier Streamlit admin UI. |
| `skills/` | The AI Skills suite — 10 deterministic skills (memo approval, aging triage, repricing, CLV, collections, demand, quotes, threads, morning briefing, example). |
| `automation/` | The Scintilla autopilot. `automation/scripts/orchestrator.py` chains the steps (`triage-inventory → propose-repricing → rank-customer-clv → decide-memo`); each step lives in its own folder and writes to `data/working/`. |
| `rag/` | Retrieval knowledge base (`knowledge_base/`) and its vector `index/`. |
| `mcp/` | MCP servers exposing the tools to Claude / the app. |
| `data/` | `raw/` seeds, `processed/`, `working/` (pipeline outputs the UI renders), `scenarios/`, `dictionaries/`, plus `generators/` (the scripts that synthesise the seed data). |
| `utils/` | Shared Python helpers (`connect.py`, `oauth_gpt.py`, `pramukh_common.py`). |
| `hooks/` | Claude Code config — `hooks/`, slash `commands/`, and skill registrations. |
| `tests/` | Test suites for skills, automations, MCP servers, and data integrity. |
| `docs/` | Deliverables and write-ups, split into `milestone-01/`, `milestone-02/`, `milestone-03/` (PDFs, slides, strategy, workflow notes). |

Project backbone at the root: `pyproject.toml`, `uv.lock`, `conftest.py`,
`.mcp.json`, `install.sh`, `.env.example`.

## Open the UI

Launch the web app with the bundled command (double-click it in Finder, or run it):

```bash
"./Mahant Exports.command"
```

On the **first run** it walks you through database setup (free hosted Neon),
installs dependencies, runs migrations, and seeds sample data. **Every run after**
it just starts the dev server and opens your browser — storefront at
`http://localhost:3000`, admin at `http://localhost:3000/admin/login`
(default login `admin@mahant.test` / `admin123`). Press Ctrl+C to stop.

The launcher resolves paths relative to itself, so it works wherever you move
this folder.

## Setup

Real `.env` secrets were stripped from this bundle — copy `.env.example` and fill
in your keys. Generated/dependency dirs (`node_modules/`, `.next/`, `.venv/`,
`__pycache__/`) and large demo videos were excluded; regenerate them:

- `ui/web`: `npm install`
- Python (skills / automation / mcp): `uv sync`

## Consistent CLV tiering (one definition everywhere)

All tools now share **one** CLV tier vocabulary — **`Top / High / Mid / Low`, by
CLV quartile** (top 25% / next 25% / next 25% / bottom 25%). Previously each
layer used its own scheme (`Diamond/Gold/Silver`, `PLATINUM/GOLD/SILVER/BRONZE`,
etc.), so "mid-CLV" meant different customers in different screens.

- Canonical method: `automation/rank-customer-clv` (sales-history quartiles).
- The CLV skill (`skills/clv-broker-company`) now emits the same `tier` column —
  verified identical to the automation tier-for-tier.
- The memo gate sources its "mid-CLV" check from these quartiles (the `Mid`
  tier) in both the skill and the autopilot, so the same customers are flagged.
- The web UI's CLV screen (`ui/web/.../clvAnalysis.ts`) uses the same
  `Top/High/Mid/Low` quartile buckets.

Note: the web UI runs on its own Prisma dataset (enquiry-based estimate), while
the skill/automation run on the CSV seeds (sales-history) — so the *vocabulary
and bucketing rule* are now identical across all three, even though the
underlying numbers come from different data sources.

## Memo approval — FIFO + HITL gate

The memo flow was reworked so the desk no longer hand-picks who receives a stone.
Each pending memo is auto-routed by **first-come (FIFO)** order plus two guardrails.
Precedence per request:

1. Requester already received this stone before → **auto-reject**
2. Mid-CLV customer (`Mid` tier) requesting **>1** stone → **needs human sign-off** *(the only review case)*
3. Earliest pending request for the stone (FIFO winner) → **auto-approve**
4. Stone already taken by an earlier request / active hold → **auto-reject**

Where it lives:
- **Skill:** `skills/memo-approval/` → `AUTO_APPROVE` / `NEEDS_REVIEW` / `AUTO_REJECT`.
- **Autopilot (source of truth for the UI):** `automation/decide-memo/scripts/decide_memo.py`
  writes `data/working/memo_decisions.csv`, rendered by the web UI's three-column
  memo board (`ui/web/src/components/admin/m3/MemoOutcomes.tsx`).
- **Standalone advisor:** `ui/web/src/lib/ai-skills/memoApproval.ts` (+ heuristic
  fallback) and the page `ui/web/src/app/admin/ai/memo/` use the same three-bucket
  vocabulary and guardrails.
- Memo data now carries per-request **timestamps** (`request_date`) to simulate
  requests arriving over time, which drives FIFO ordering.
