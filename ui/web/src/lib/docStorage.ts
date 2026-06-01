// Storage interface for customer documents.
//
// Current implementation: stores raw bytes in Postgres on `CustomerDocument`.
// This is fine for the dev/MVP phase with a small customer base.
//
// Production swap: replace the body of these functions with calls to Cloudflare
// R2 / S3. Callers only see this interface, so no other code needs to change.
// At that point `fileBytes` becomes `storageKey` (string) and a separate signed-URL
// helper is added.

import { prisma } from './db';
import type { DocumentKind } from '@prisma/client';

export type UploadInput = {
  customerId: string;
  kind: DocumentKind;
  label: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
};

export const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export class DocStorageError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function saveDocument(input: UploadInput) {
  if (input.bytes.byteLength > MAX_DOC_BYTES) {
    throw new DocStorageError(413, `File too large — max ${MAX_DOC_BYTES / 1024 / 1024} MB.`);
  }
  if (!ALLOWED_MIME.has(input.mimeType)) {
    throw new DocStorageError(415, `Unsupported file type: ${input.mimeType}. Use PDF or image.`);
  }
  return prisma.customerDocument.create({
    data: {
      customerId: input.customerId,
      kind: input.kind,
      label: input.label,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.byteLength,
      fileBytes: input.bytes,
    },
  });
}

export async function getDocument(id: string) {
  return prisma.customerDocument.findUnique({ where: { id } });
}

export async function deleteDocument(id: string) {
  return prisma.customerDocument.delete({ where: { id } });
}

export async function listDocumentsForCustomer(customerId: string) {
  return prisma.customerDocument.findMany({
    where: { customerId },
    orderBy: { uploadedAt: 'desc' },
    // Don't load bytes when listing — only metadata.
    select: {
      id: true, customerId: true, kind: true, label: true,
      filename: true, mimeType: true, sizeBytes: true, uploadedAt: true,
    },
  });
}
