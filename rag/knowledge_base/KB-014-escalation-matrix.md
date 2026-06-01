---
doc_id: KB-014
title: Escalation matrix
type: policy
owner: Operations
audience: all_staff
last_updated: 2026-02-20
classification: internal
related_systems: All
---

# Escalation matrix

Use this to figure out who to ping when something is outside your
normal authority. Try the level immediately above you first; only
skip levels for genuine emergencies (vault discrepancy, AML hit,
fraud-suspected payment).

## Roles

| Role | Person | Channel of choice |
| --- | --- | --- |
| Tier-1 ops              | rotating  | WhatsApp group "Vault Ops" |
| Sales rep               | named     | WhatsApp DM |
| Sales Head              | Pratik    | WhatsApp DM, then phone if no reply in 15 min |
| Operations Lead         | Rohit     | WhatsApp DM, then phone |
| IT Lead                 | Anjali    | Slack #it-leads |
| Finance Lead            | Shilpa    | Email, escalate to phone for cash-impacting items |
| Owner                   | Mahesh    | Phone only (DMs are screened) |
| Compliance              | Avantika  | Email |
| External counsel        | (Khaitan & Co) | via Compliance |

## Decisions by category

| Decision | Authority | Backup |
| --- | --- | --- |
| Memo approval, default rules (KB-001) | Sales Head | Owner |
| Memo > maximum hold period | Owner | — |
| Customer KYC approval | Compliance + Sales Head (joint) | Owner |
| Customer suspension | Sales Head | Owner |
| Price below margin floor (KB-004 factor 9) | Owner | — |
| Returns within 7 days (KB-006) | Sales Head | Owner |
| Returns outside the 7-day window | Owner | — |
| Damage fee waiver | Owner | — |
| Bonus structure change (KB-009) | HR + Owner | — |
| Rapaport license usage question (KB-011) | Sales Head | Compliance |
| Export courier outside KB-013 | Owner | — |
| AML hit on a customer | Compliance | Owner + external counsel |
| Vault audit discrepancy (KB-005) | Owner | external counsel |
| IT incident open > 30 min | IT Lead | Owner |
| Security incident (phishing, breach) | IT Lead + Compliance | Owner + external counsel |

## Time bands

- **Immediate** (call within minutes): vault discrepancy, AML hit,
  security incident, payment fraud.
- **Same business day**: most decisions in the table above.
- **Within 48 hours**: anything HR / handbook / contract-related.

## After hours

Phone first for immediate items; WhatsApp first for everything
else. Each role above has a deputy in the rotating "Vault Ops" WA
group; if the primary doesn't reply, ping the group.
