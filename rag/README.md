# `rag/` — proprietary knowledge corpus

**Per the May 21 updated M03 spec, RAG implementation is descoped.**
This folder ships the corpus only — 14 markdown documents that an AI
coworker on the diamond desk would need to cite to answer questions
about how the business actually runs. No retriever, no index, no
skill integration.

## Layout

```
rag/
├── README.md                              ← this file
└── knowledge_base/
    ├── INDEX.md                           ← human-readable index + cross-link map
    ├── KB-001-broker-memo-policy.md
    ├── KB-002-customer-kyc-sop.md
    ├── KB-003-payment-terms-playbook.md
    ├── KB-004-rapaport-repricing-rules.md
    ├── KB-005-vault-sop.md
    ├── KB-006-returns-and-refunds-policy.md
    ├── KB-007-customer-tier-definitions.md
    ├── KB-008-whatsapp-negotiation-guidelines.md
    ├── KB-009-sales-bonus-structure.md
    ├── KB-010-inventory-app-runbook.md
    ├── KB-011-rapaport-license-excerpt.md
    ├── KB-012-q1-2026-sales-review.md
    ├── KB-013-shipping-dispatch-sop.md
    └── KB-014-escalation-matrix.md
```

Total: 14 documents, ~5 800 words. Mix of policies, SOPs, vendor
contracts, runbooks, meeting notes, and handbook excerpts —
proprietary content the AI would not have seen in pre-training.

## Frontmatter contract

Every KB document carries the same YAML frontmatter so a future
retriever can filter on any axis:

```markdown
---
doc_id: KB-001
title: Broker memo (consignment) approval policy
type: policy            # policy | sop | runbook | handbook | vendor_contract | meeting_notes
owner: Sales Head       # role responsible
audience: sales_desk    # who should read it
last_updated: 2026-04-12
classification: internal | confidential
related_systems: ...    # which apps / tables / skills reference it
---
```

## Separation of concerns

This folder is **separate from `data/`** by design.

- `data/` is the operational state the workflow processes — the
  diamond inventory, the customer list, the memo requests, etc.
  It's what the four M03 automations read and write.
- `rag/` is the proprietary knowledge a sales rep or an AI coworker
  on the desk would need to *understand* the work — the policies,
  the SOPs, the playbook the desk follows. This is what RAG would
  retrieve from at query time.

Mixing the two would defeat the point of the RAG exercise.

## How each automation cites the corpus

The four automation READMEs each link out to the policy or SOP that
governs the rules they encode (see the **M01 connection** section
of each automation's README). The cross-link map is in
[`knowledge_base/INDEX.md`](knowledge_base/INDEX.md).

This is the only "RAG integration" we ship per the updated M03 spec:
the automations name the documents that justify their rules, so a
human (or a future LLM) can follow the trail.

## What's intentionally absent

| Originally planned | Status |
| --- | --- |
| Index build (`build_index.py`) | not shipped (descoped) |
| `retrieve(query, top_k)` function (`retrieval.py`) | not shipped (descoped) |
| Wired into a skill so the LLM cites docs | not shipped (descoped) |
| Naive vs. HyQ comparison demo | not shipped (descoped) |
| Tests of retrieval accuracy | not shipped (descoped) |

If RAG comes back into scope later, the natural integration point is
`automations/decide-memo`: when the deterministic router lands on
`needs_review`, the Mahant memo-detail modal could surface the
relevant KB doc(s) (KB-001 + KB-007 + the customer's tier) as
"why this came to you" cards.
