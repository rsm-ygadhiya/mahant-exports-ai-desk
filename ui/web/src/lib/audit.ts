// Lightweight wrapper around the AuditLog table.
//
// Every privileged action (permission change, KYC approval, cash approval,
// status flip, set-stone-live, etc.) should call audit(...) so we have a
// permanent who-did-what-when trail.
//
// Spec reference: admin_panel_spec.md §1.4 + Appendix rule 6.

import { prisma } from './db';

export type AuditAction =
  | 'permission.grant'
  | 'permission.revoke'
  | 'permission.replace'
  | 'admin.create'
  | 'admin.deactivate'
  | 'admin.reactivate'
  | 'admin.role_change'
  | 'admin.login'              // recorded on successful sign-in
  | 'admin.logout'             // recorded on sign-out
  | 'kyc.approve'
  | 'kyc.reject'
  | 'kyc.request_docs'
  | 'cash.approve'
  | 'stone.set_live'
  | 'stone.set_not_live'
  | 'stone.status_change'      // mark sold / hold / available outside the order/memo flows
  | 'stone.import'             // Excel stock upload
  | 'stone.delete'
  | 'stone.edit'               // price / remarks / location etc.
  | 'rap.import'               // Rap sheet upload
  | 'enquiry.approve_memo'
  | 'enquiry.approve_sale'
  | 'enquiry.cancel'
  | 'pricing.apply'
  | 'pricing.proposal_edit'
  | 'pricing.run.create'
  | 'pricing.run.decide'
  | 'customer.create'
  | 'customer.edit'
  | 'order.create'
  | 'order.cancel'
  | 'backup.create'
  | 'backup.delete';

export async function audit(args: {
  actorId: string;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  notes?: string;
  ipAddress?: string;
}) {
  return prisma.auditLog.create({
    data: {
      actorId: args.actorId,
      action: args.action,
      targetType: args.targetType,
      targetId: args.targetId,
      oldValue: args.oldValue == null ? undefined : (args.oldValue as any),
      newValue: args.newValue == null ? undefined : (args.newValue as any),
      notes: args.notes,
      ipAddress: args.ipAddress,
    },
  });
}
