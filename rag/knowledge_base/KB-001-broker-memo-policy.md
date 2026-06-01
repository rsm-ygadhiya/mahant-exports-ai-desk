---
doc_id: KB-001
title: Broker memo (consignment) approval policy
type: policy
owner: Sales Head
audience: sales_desk
last_updated: 2026-04-12
classification: internal
related_systems: Inventory App, Scintilla
---

# Broker memo (consignment) approval policy

This policy supersedes the verbal rules in use until March 2026. Any
memo request handled by the desk after April 12, 2026 must follow it.
The desk software (Scintilla) implements decision-point B against the
thresholds defined here.

## Default rules

A memo request **auto-approves** only when **all four** of the
following hold:

1. The deterministic memo recommendation is `APPROVE` (not
   `APPROVE_WITH_CONDITIONS` or `REJECT`).
2. The requester's CLV tier is **Top** or **High**.
3. The requested stone is **not** tagged `HOLD` by inventory triage.
4. The opportunity-cost score is **≤ 70 / 100**.

Anything else routes to the human review queue. The Sales Head is the
sole authority for the manual approve / reject call.

## Hard rejects

Three conditions trigger an automatic **reject** with no human review:

- The requester's CLV tier is **Low** AND the deterministic
  recommendation is `REJECT` — this is the "clear reject" path.
- The stone is **already on an active memo** for another customer.
  The decline message must explicitly say so and suggest an alternate
  stone in the same category.
- The requester is on the **kyc_blocked** list (see KB-002).

## Hold-period defaults

| CLV tier | Default hold | Maximum hold |
| --- | ---: | ---: |
| Top   | 14 days | 21 days |
| High  | 10 days | 14 days |
| Mid   | 7 days  | 10 days |
| Low   | 5 days  | 7 days  |

Exceeding the maximum hold requires Owner-level sign-off, not Sales
Head. Any extension is logged in `data/working/memo_decisions.csv`
with the `condition_max_hold_days` field set.

## Concurrent open memos per requester

- Top / High: up to 5 concurrent.
- Mid: up to 3 concurrent.
- Low: 1 concurrent.

If a requester is at or above their cap, every additional request
goes to human review regardless of the other signals.
