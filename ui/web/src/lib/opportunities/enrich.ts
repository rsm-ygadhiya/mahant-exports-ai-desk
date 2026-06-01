/**
 * LLM helpers for the Opportunity Finder:
 *   - draftEmail(opportunity, ctx)  : writes a personalized outreach email
 *   - prefillPortalForm(...)        : builds the supplier-portal application
 *
 * Scraping leads is now handled by ./scrape.ts (OpenAI web search). The
 * legacy `enrichBatch` helper was removed along with the seed list.
 */

import { askClaude, TRITON_AVAILABLE } from '@/lib/tritonClaude';
import type { EmailDraft, EnrichedOpportunity, PortalForm } from './store';

const MAHANT_PROFILE = `Mahant Exports is a B2B lab-grown diamond wholesaler based in Surat, India.
We carry IGI- and GIA-certified LG stones from 0.30ct to 5.00ct across rounds, ovals,
emeralds, princess, and fancy shapes — VVS+ clarity in the bridal range. We supply
specialty jewelers, bridal chains, and online marketplaces with weekly Rap-pegged
pricing and direct-from-cutter margins. Distinguishing features: 15-factor weekly
repricing engine, FIFO memo allocation, and customer-tier-aware quoting — all of
which we use internally to keep allocation fair and prices fresh.`;

// ─────────────────────────────────────────────────────────────────────────────
//  Email drafting + portal-form prefill

const EMAIL_SYSTEM = `You write B2B outreach emails for Mahant Exports, a
lab-grown diamond wholesaler in Surat, India.

Style rules:
  • Plain prose, no markdown, no emoji.
  • 110-160 words. Three short paragraphs.
  • Open with a specific reason for outreach — reference the target company's
    own sourcing program or category strategy (use the fit_summary).
  • Middle paragraph: 2-3 concrete facts about Mahant that match what they buy
    (certifications, shape mix, ct range, weekly Rap pricing).
  • Close: a soft ask for a 20-minute intro call OR a sample parcel review.
  • Sign as "Mahant Exports — Wholesale Desk". No phone number, no PS line.

Return ONLY valid JSON:
  { "subject": "...", "body": "..." }
No commentary, no markdown fences.`;

export async function draftEmail(
  opp: EnrichedOpportunity,
  inventorySnapshot: string,
): Promise<EmailDraft> {
  const to_role = opp.contact_role || 'Sourcing Lead';
  const to = `${opp.id}-sourcing@example.com`; // placeholder address; the user replaces before sending

  if (!TRITON_AVAILABLE()) {
    return {
      to, to_role,
      subject: `Lab-grown diamond supply for ${opp.company}`,
      body: `Hi ${to_role},\n\nNoticed ${opp.company}'s ${opp.reported_demand}. Mahant Exports supplies IGI- and GIA-certified LG stones across the ranges you carry, with weekly Rap-pegged pricing and direct-from-cutter margins.\n\nWould a 20-minute intro call make sense? Happy to send a sample parcel.\n\nMahant Exports — Wholesale Desk`,
    };
  }

  const userMessage = `Target company: ${opp.company} (${opp.region}, ${opp.segment})
Reported demand: ${opp.reported_demand}
Fit summary: ${opp.fit_summary}
Likely recipient role: ${to_role}

Mahant inventory snapshot:
${inventorySnapshot}`;

  try {
    const { answer } = await askClaude({
      system: EMAIL_SYSTEM,
      cachedContext: MAHANT_PROFILE,
      userMessage,
    });
    // Best-effort JSON extraction
    const open = answer.indexOf('{');
    const close = answer.lastIndexOf('}');
    if (open >= 0 && close > open) {
      const j = JSON.parse(answer.slice(open, close + 1));
      return {
        to, to_role,
        subject: String(j.subject ?? `Lab-grown diamond supply for ${opp.company}`),
        body: String(j.body ?? ''),
      };
    }
  } catch { /* fall through */ }

  return {
    to, to_role,
    subject: `Lab-grown diamond supply for ${opp.company}`,
    body: `Hi ${to_role},\n\n(LLM unavailable — please draft manually.)\n\nMahant Exports — Wholesale Desk`,
  };
}

export function prefillPortalForm(opp: EnrichedOpportunity, inventorySnapshot: string): PortalForm {
  return {
    company_name: 'Mahant Exports Pvt. Ltd.',
    founded: '2014',
    hq: 'Surat, Gujarat, India',
    certifications: 'IGI, GIA, SGL — every stone certified before despatch',
    inventory_summary: inventorySnapshot,
    unique_value: 'Direct-from-cutter pricing, weekly 15-factor Rap-pegged repricing, FIFO memo allocation for transparent customer ranking.',
    contact_name: 'Yug Gadhiya',
    contact_email: 'ygadhiya@mahant.test',
    contact_phone: '+91 99999 99999',
  };
}
