---
doc_id: KB-005
title: Vault intake and audit SOP
type: sop
owner: Operations
audience: ops_admin
last_updated: 2026-02-15
classification: confidential
related_systems: Inventory App, IGI Lab Portal
---

# Vault intake and audit SOP

The Mumbai vault stores all polished inventory between the QC sign-off
and the dispatch step. Every stone is photographed, logged, and
re-weighed before being placed in a numbered slot. Tier-1 vault staff
follow this SOP for every intake event; deviations require Owner
sign-off and a written incident note.

## Intake checklist (per parcel)

1. Open the parcel only in the **camera-monitored intake bay**
   (slot 1, west wall). Never in the open office.
2. Verify the IGI report number on the parcel slip matches the report
   number printed inside the certificate envelope.
3. Re-weigh on the calibrated scale (model: A&D HR-250AZ). The
   measured carat must be within ±0.003 ct of the cert value;
   anything outside that goes to QC re-inspect.
4. Photograph the stone face-up + face-down on the gridded mat. Save
   to `inventory_photos/<stoneId>.jpg`.
5. Assign a vault location code in the inventory app — the format is
   `<row>-<column>-<slot>`, e.g. `B-04-13`.
6. Print the location label and tape it to the bottom of the
   container.

## Location coding

| Row prefix | Use |
| --- | --- |
| `A`        | Round, 0.25–0.99 ct |
| `B`        | Round, 1.00 ct and above |
| `C`        | Fancy shapes, 0.25–0.99 ct |
| `D`        | Fancy shapes, 1.00 ct and above |
| `E`        | Parcels on memo (read-only, watched by camera 7) |
| `F`        | Returns / under investigation (locked separately) |

## Weekly audit

The Sales Head + one ops staffer do a full vault count every Friday
07:00 IST. Stones flagged `OnMemo` in the inventory app but **not**
physically in row E for that whole week must be reconciled before the
Friday Rap repricing run starts. This is the "no-floating-memo" rule.

## Damage and discrepancy

Any chip, abrasion, or weight drift > 0.005 ct is recorded as an
incident and the stone is moved to row F. The Owner is paged within
30 minutes for any incident on a stone valued > ₹500 000.
