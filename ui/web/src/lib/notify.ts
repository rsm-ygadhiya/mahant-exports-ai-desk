// Customer notification dispatcher.
//
// Today: logs the intended message to the server console (visible in your
// Terminal when running locally). This makes the flow testable end-to-end
// without wiring an SMS/email provider yet.
//
// Phase 2: replace the body with a real call to MSG91 (SMS) and SendGrid/SES
// (email). Templates will come from a `MessageTemplate` table — that's the
// P6 work. For now the message body is hardcoded per action.

// Simple console-based logger. When the project gets a proper logger (pino, etc.)
// swap these calls — keeps notify.ts portable in the meantime.
const logger = {
  info: (obj: any, msg?: string) => console.log('[notify]', msg ?? '', obj),
};

export type NotifyChannel = 'sms' | 'email';

export type NotifyArgs = {
  customer: { mobile: string; email?: string | null; companyName: string; contactPerson: string };
  channels?: NotifyChannel[]; // default: both, if recipient available
  subject?: string;            // email only
  body: string;
  reason?: string;             // why we're sending (audit trail)
};

export async function notifyCustomer(args: NotifyArgs): Promise<{ delivered: NotifyChannel[] }> {
  const channels = args.channels ?? ['sms', 'email'];
  const delivered: NotifyChannel[] = [];

  for (const ch of channels) {
    if (ch === 'email') {
      if (!args.customer.email) continue;
      // TODO[P6 templates]: send via SendGrid/SES with templated body.
      logger.info({
        to: args.customer.email, channel: 'email',
        subject: args.subject ?? '(no subject)',
        reason: args.reason,
      }, '[dev notify] would send email');
      delivered.push('email');
    } else {
      // TODO[P2 wiring]: send via MSG91 SMS API.
      logger.info({
        to: args.customer.mobile, channel: 'sms', reason: args.reason,
      }, '[dev notify] would send SMS');
      delivered.push('sms');
    }
  }

  // Always log the body in dev so you can see what the customer would receive.
  logger.info({ recipient: args.customer.contactPerson, body: args.body, reason: args.reason },
              '[dev notify] message body');

  return { delivered };
}
