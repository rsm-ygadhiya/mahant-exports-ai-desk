// Message template system (P5/P6).
//
// Every customer-facing message goes through here. The Owner edits templates
// via /admin/templates; the rest of the codebase calls renderTemplate(key, vars)
// or sendTemplatedMessage(key, customer, vars).
//
// Placeholder syntax: simple {{variable}} substitution. Missing variables are
// replaced with an empty string (and logged as a warning). HTML escaping is
// NOT applied — messages go to SMS / plain-text email.

import { prisma } from './db';
import { notifyCustomer, type NotifyChannel } from './notify';
import type { TemplateChannel } from '@prisma/client';

/** Type-safe key list — keep in sync with DEFAULT_TEMPLATES below. */
export type TemplateKey =
  | 'kyc.approve'
  | 'kyc.reject'
  | 'kyc.request_docs'
  | 'enquiry.memo_approved'
  | 'enquiry.sale_confirmed'
  | 'enquiry.cancelled'
  | 'bank.details'
  | 'payment.reminder.before_due'
  | 'payment.reminder.due_today'
  | 'payment.reminder.overdue';

export type DefaultTemplate = {
  key: TemplateKey;
  name: string;
  description: string;
  subject?: string;
  body: string;
  channel: TemplateChannel;
};

/**
 * Seeded built-in templates. The seeder upserts these on every run so the
 * Owner can edit them but never lose the originals. Placeholders are
 * documented inline so the editor UI can show available variables.
 */
export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    key: 'kyc.approve', name: 'KYC — Approved',
    description: 'Sent when admin approves a buyer\'s KYC. Vars: {{contactPerson}}, {{companyName}}, {{uniqueCode}}',
    subject: 'Mahant Exports — Account Approved',
    body:
`Hello {{contactPerson}},

Your KYC has been approved. Your customer ID is {{uniqueCode}}.
You can now view prices and place enquiries on our platform.

Welcome aboard.
— Mahant Exports`,
    channel: 'BOTH',
  },
  {
    key: 'kyc.reject', name: 'KYC — Rejected',
    description: 'Sent when admin rejects KYC. Vars: {{contactPerson}}, {{reason}}',
    subject: 'Mahant Exports — KYC Update',
    body:
`Hello {{contactPerson}},

We were unable to approve your KYC at this time.
Reason: {{reason}}

If you believe this is in error, reply to this message.
— Mahant Exports`,
    channel: 'BOTH',
  },
  {
    key: 'kyc.request_docs', name: 'KYC — More Documents Needed',
    description: 'Sent when admin requests additional documents. Vars: {{contactPerson}}, {{reason}}',
    subject: 'Mahant Exports — Additional Documents Needed',
    body:
`Hello {{contactPerson}},

To complete your KYC we need the following:
{{reason}}

Please upload the missing documents at your account portal.
— Mahant Exports`,
    channel: 'BOTH',
  },
  {
    key: 'enquiry.memo_approved', name: 'Enquiry — Approved for Memo',
    description: 'Sent when admin places stones on memo (spec §7.3). Vars: {{contactPerson}}, {{stonesList}}, {{memoLocation}}, {{memoPickupAt}}',
    subject: 'Mahant Exports — Memo Approved',
    body:
`Hello {{contactPerson}},

Your request for the following stones has been approved on memo:

{{stonesList}}

Please come and collect at {{memoLocation}} on {{memoPickupAt}}.
Our team will be in touch to confirm.

— Mahant Exports`,
    channel: 'BOTH',
  },
  {
    key: 'enquiry.sale_confirmed', name: 'Enquiry — Sale Confirmed',
    description: 'Sent when admin converts an enquiry to a confirmed sale. Vars: {{contactPerson}}, {{orderCode}}, {{stonesList}}, {{totalAmount}}, {{dueDate}}',
    subject: 'Mahant Exports — Sale Confirmation {{orderCode}}',
    body:
`Hello {{contactPerson}},

Your purchase has been confirmed. Order details:

Order #: {{orderCode}}
Items:
{{stonesList}}

Total: {{totalAmount}}
Payment due: {{dueDate}}

Bank details for payment will follow in a separate message.

Thank you for your business.
— Mahant Exports`,
    channel: 'BOTH',
  },
  {
    key: 'enquiry.cancelled', name: 'Enquiry — Cancelled',
    description: 'Sent when admin cancels an enquiry. Vars: {{contactPerson}}, {{stonesList}}, {{reason}}',
    subject: 'Mahant Exports — Enquiry Update',
    body:
`Hello {{contactPerson}},

Thank you for your enquiry regarding the following stones:

{{stonesList}}

Unfortunately, we are unable to fulfil this request at this time.
{{reason}}

We apologise for the inconvenience and hope to assist you in the future.
— Mahant Exports`,
    channel: 'BOTH',
  },
  {
    key: 'bank.details', name: 'Bank Details (sent after sale)',
    description: 'Bank account info sent to customers for payment. Edit this with YOUR bank info. Vars: {{contactPerson}}, {{orderCode}}, {{totalAmount}}',
    subject: 'Mahant Exports — Bank Details for {{orderCode}}',
    body:
`Hello {{contactPerson}},

Please find our bank details for payment of order {{orderCode}} ({{totalAmount}}):

Beneficiary:    Mahant Exports
Bank:           [Bank Name]
Account No:     [Account Number]
IFSC / SWIFT:   [IFSC / SWIFT Code]
Branch:         [Branch Name]

Kindly share the transfer reference once paid.

— Mahant Exports`,
    channel: 'EMAIL',
  },
  {
    key: 'payment.reminder.before_due', name: 'Payment Reminder — Before Due',
    description: 'Friendly reminder before due date. Vars: {{contactPerson}}, {{orderCode}}, {{totalAmount}}, {{outstanding}}, {{dueDate}}, {{daysUntilDue}}',
    subject: 'Mahant Exports — Payment Reminder',
    body:
`Hello {{contactPerson}},

A friendly reminder: payment of {{outstanding}} on order {{orderCode}} is due in {{daysUntilDue}} day(s) ({{dueDate}}).

If you've already paid, please disregard this message and share the transfer reference.

— Mahant Exports`,
    channel: 'BOTH',
  },
  {
    key: 'payment.reminder.due_today', name: 'Payment Reminder — Due Today',
    description: 'Reminder on the due date. Vars: {{contactPerson}}, {{orderCode}}, {{outstanding}}',
    subject: 'Mahant Exports — Payment Due Today',
    body:
`Hello {{contactPerson}},

Payment of {{outstanding}} on order {{orderCode}} is due today.

Please process at your earliest convenience.

— Mahant Exports`,
    channel: 'BOTH',
  },
  {
    key: 'payment.reminder.overdue', name: 'Payment Reminder — Overdue',
    description: 'Escalated reminder for overdue invoices. Vars: {{contactPerson}}, {{orderCode}}, {{outstanding}}, {{daysOverdue}}',
    subject: 'Mahant Exports — Payment Overdue',
    body:
`Hello {{contactPerson}},

Our records show payment of {{outstanding}} on order {{orderCode}} is now {{daysOverdue}} day(s) overdue.

Please resolve this urgently — reply to confirm payment status.

— Mahant Exports`,
    channel: 'BOTH',
  },
];

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

/** Substitute {{var}} placeholders. Missing keys → empty string. */
export function render(body: string, vars: Record<string, any>): string {
  return body.replace(PLACEHOLDER_RE, (_, key) => {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    return String(v);
  });
}

/** Look up a template by key and substitute. Falls back to default body if DB is empty. */
export async function renderTemplate(
  key: TemplateKey,
  vars: Record<string, any>,
): Promise<{ subject: string; body: string; channel: TemplateChannel }> {
  const row = await prisma.messageTemplate.findUnique({ where: { key } });
  if (row) {
    return {
      subject: render(row.subject ?? '', vars),
      body: render(row.body, vars),
      channel: row.channel,
    };
  }
  // Fallback — template not yet seeded.
  const def = DEFAULT_TEMPLATES.find(t => t.key === key);
  if (!def) throw new Error(`Unknown template key: ${key}`);
  return {
    subject: render(def.subject ?? '', vars),
    body: render(def.body, vars),
    channel: def.channel,
  };
}

/** End-to-end: render the template and dispatch via notify lib. */
export async function sendTemplatedMessage(args: {
  key: TemplateKey;
  customer: { mobile: string; email?: string | null; companyName: string; contactPerson: string };
  vars: Record<string, any>;
  channelsOverride?: NotifyChannel[];
}) {
  const rendered = await renderTemplate(args.key, args.vars);
  let channels: NotifyChannel[];
  if (args.channelsOverride) channels = args.channelsOverride;
  else if (rendered.channel === 'SMS') channels = ['sms'];
  else if (rendered.channel === 'EMAIL') channels = ['email'];
  else channels = ['sms', 'email'];

  return notifyCustomer({
    customer: args.customer,
    channels,
    subject: rendered.subject || undefined,
    body: rendered.body,
    reason: args.key,
  });
}
