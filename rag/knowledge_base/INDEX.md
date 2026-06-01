---
doc_id: INDEX
title: Knowledge base index
type: index
audience: all_staff
last_updated: 2026-05-20
---

# Pramukh Gems — proprietary knowledge base index

14 documents totalling ~5 800 words. Every doc carries the same
YAML frontmatter so a future retriever can filter by `type`,
`owner`, `audience`, or `classification`.

| # | Title | Type | Owner | Audience |
| - | --- | --- | --- | --- |
| KB-001 | [Broker memo (consignment) approval policy](KB-001-broker-memo-policy.md)        | policy           | Sales Head  | sales_desk |
| KB-002 | [Customer KYC and onboarding SOP](KB-002-customer-kyc-sop.md)                    | sop              | Compliance  | ops_admin |
| KB-003 | [Payment terms playbook](KB-003-payment-terms-playbook.md)                       | policy           | Finance     | sales_desk |
| KB-004 | [Weekly Rapaport repricing rules](KB-004-rapaport-repricing-rules.md)            | policy           | Sales Head  | sales_desk |
| KB-005 | [Vault intake and audit SOP](KB-005-vault-sop.md)                                | sop              | Operations  | ops_admin |
| KB-006 | [Returns, refunds, and re-takes policy](KB-006-returns-and-refunds-policy.md)    | policy           | Sales Head  | sales_desk |
| KB-007 | [Customer tier definitions (Top / High / Mid / Low)](KB-007-customer-tier-definitions.md) | policy | Sales Head | sales_desk |
| KB-008 | [WhatsApp negotiation guidelines](KB-008-whatsapp-negotiation-guidelines.md)     | handbook         | Sales Head  | sales_desk |
| KB-009 | [Sales rep bonus structure (FY 2026)](KB-009-sales-bonus-structure.md)           | handbook         | HR          | sales_desk |
| KB-010 | [Inventory App — Tier-1 IT runbook](KB-010-inventory-app-runbook.md)             | runbook          | IT          | tier_1_it |
| KB-011 | [Rapaport price list — license terms (excerpt)](KB-011-rapaport-license-excerpt.md) | vendor_contract | Legal     | sales_desk |
| KB-012 | [Q1 2026 sales review — meeting notes](KB-012-q1-2026-sales-review.md)           | meeting_notes    | Sales Head  | leadership |
| KB-013 | [Shipping and dispatch SOP](KB-013-shipping-dispatch-sop.md)                     | sop              | Operations  | ops_admin |
| KB-014 | [Escalation matrix](KB-014-escalation-matrix.md)                                 | policy           | Operations  | all_staff |

## Coverage map — which automation cites which doc

The automation READMEs link out to the policy doc that governs the
rules they encode. This is the only cross-link we ship; no retriever
is implemented per the updated M03 spec.

| Automation | Cites |
| --- | --- |
| `triage-inventory`   | KB-004 (factor 3 — triage tag override on price) |
| `propose-repricing`  | KB-004 (the full 15-factor recipe) · KB-011 (Rap license terms) |
| `rank-customer-clv`  | KB-007 (CLV formula + tier benefits) |
| `decide-memo`        | KB-001 (memo approval policy) · KB-007 (tier eligibility) |
| Mahant collections   | KB-003 (late-payment escalation) |
| Mahant KYC review    | KB-002 |
