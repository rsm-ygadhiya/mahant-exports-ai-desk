// Payment recording + cash approval flow.
//
// Spec §8.6: Cash payments can NEVER be auto-confirmed. The recording user
// (Sales or anyone with sales.edit) gets a one-time approval token from this
// library. They pass it to an Accounts team member (in-person / secure channel).
// The Accounts user enters the token via the approve endpoint — system
// bcrypt-compares against the hashed copy, and if matched, flips the payment
// to CONFIRMED. Audit log captures actor + timestamp; token never logged.

import bcrypt from 'bcryptjs';
import { prisma } from './db';
import { audit } from './audit';
import type { PaymentMethod } from '@prisma/client';

export type RecordPaymentInput = {
  orderId: string;
  amount: number;
  method: PaymentMethod;
  transactionRef?: string;
  notes?: string;
  recordedBy: string;     // Admin.id
};

export type RecordResult = {
  paymentId: string;
  status: 'CONFIRMED' | 'PENDING_CASH_APPROVAL';
  /** Plain 6-digit approval token; ONLY returned for cash payments,
   *  ONLY at recording time, NEVER stored unhashed. */
  approvalToken?: string;
};

function makeToken(): string {
  // 6 digits, zero-padded. Easy for Sales to dictate to Accounts.
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

export async function recordPayment(input: RecordPaymentInput): Promise<RecordResult> {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order) throw new Error('Order not found.');
  if (order.status !== 'CONFIRMED') throw new Error('Can only record payments on CONFIRMED orders.');
  if (input.amount <= 0) throw new Error('Amount must be positive.');

  if (input.method === 'CASH') {
    const token = makeToken();
    const hash = await bcrypt.hash(token, 10);
    const payment = await prisma.payment.create({
      data: {
        orderId: input.orderId,
        amount: input.amount as any,
        method: 'CASH',
        status: 'PENDING_CASH_APPROVAL',
        transactionRef: input.transactionRef,
        notes: input.notes,
        approvalHash: hash,
        recordedBy: input.recordedBy,
      },
    });
    // NB: do NOT audit-log the token. Just the fact that a cash record was made.
    await audit({
      actorId: input.recordedBy, action: 'cash.approve', targetType: 'Payment', targetId: payment.id,
      notes: 'Recorded — awaiting Accounts approval', newValue: { amount: input.amount, status: 'PENDING_CASH_APPROVAL' },
    });
    return { paymentId: payment.id, status: 'PENDING_CASH_APPROVAL', approvalToken: token };
  }

  // Non-cash methods are immediately CONFIRMED (audit trail is the txn ref).
  const payment = await prisma.payment.create({
    data: {
      orderId: input.orderId,
      amount: input.amount as any,
      method: input.method,
      status: 'CONFIRMED',
      transactionRef: input.transactionRef,
      notes: input.notes,
      recordedBy: input.recordedBy,
      confirmedBy: input.recordedBy,
      confirmedAt: new Date(),
    },
  });
  await audit({
    actorId: input.recordedBy, action: 'cash.approve', // generic payment-confirm action
    targetType: 'Payment', targetId: payment.id,
    newValue: { amount: input.amount, method: input.method, status: 'CONFIRMED' },
  });
  return { paymentId: payment.id, status: 'CONFIRMED' };
}

/**
 * Confirm a pending cash payment by submitting the one-time token from the
 * recording user. The caller must already have `cash.approve` permission
 * (enforced in the API route).
 */
export async function confirmCashPayment(args: {
  paymentId: string;
  token: string;
  confirmedBy: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const payment = await prisma.payment.findUnique({ where: { id: args.paymentId } });
  if (!payment) return { ok: false, error: 'Payment not found.' };
  if (payment.status !== 'PENDING_CASH_APPROVAL') {
    return { ok: false, error: `Payment is not awaiting approval (current: ${payment.status}).` };
  }
  if (!payment.approvalHash) return { ok: false, error: 'Internal: no token hash on payment.' };

  const matches = await bcrypt.compare(args.token, payment.approvalHash);
  if (!matches) return { ok: false, error: 'Incorrect approval code.' };

  await prisma.payment.update({
    where: { id: args.paymentId },
    data: {
      status: 'CONFIRMED',
      confirmedBy: args.confirmedBy,
      confirmedAt: new Date(),
      // Token is now spent — wipe the hash so it can't be re-used or extracted.
      approvalHash: null,
    },
  });

  // Audit with NO token, NO hash. Just who/when.
  await audit({
    actorId: args.confirmedBy, action: 'cash.approve', targetType: 'Payment', targetId: args.paymentId,
    notes: 'Cash payment confirmed by Accounts with one-time token',
  });

  return { ok: true };
}

/** Reject a pending cash payment. */
export async function rejectCashPayment(args: {
  paymentId: string;
  reason: string;
  rejectedBy: string;
}) {
  const payment = await prisma.payment.findUnique({ where: { id: args.paymentId } });
  if (!payment) throw new Error('Payment not found.');
  if (payment.status !== 'PENDING_CASH_APPROVAL') {
    throw new Error('Payment is not awaiting approval.');
  }

  await prisma.payment.update({
    where: { id: args.paymentId },
    data: {
      status: 'REJECTED',
      rejectionReason: args.reason,
      confirmedBy: args.rejectedBy,
      confirmedAt: new Date(),
      approvalHash: null,
    },
  });

  await audit({
    actorId: args.rejectedBy, action: 'cash.approve', targetType: 'Payment', targetId: args.paymentId,
    notes: `REJECTED — ${args.reason}`,
  });
}
