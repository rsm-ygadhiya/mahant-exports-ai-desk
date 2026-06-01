import type { Diamond } from '@prisma/client';

const PHONE = process.env.MAHANT_WHATSAPP_NUMBER ?? '919999999999';

/** Build the WhatsApp deep link per spec section 6. */
export function buildEnquiryWhatsappUrl(diamonds: Diamond[]): string {
  const lines: string[] = [
    'Hello Mahant Exports,',
    'I am interested in the below diamonds:',
    '',
  ];
  for (const d of diamonds) {
    lines.push(`Certificate No: ${d.certificateNo ?? '-'}`);
    lines.push(`Shape: ${d.shape}`);
    lines.push(`Carat: ${d.carat}`);
    lines.push(`Color: ${d.color}`);
    lines.push(`Clarity: ${d.clarity}`);
    lines.push(`Price: ${d.totalPrice} ${d.currency}`);
    lines.push('---');
  }
  lines.push('Please confirm availability.');
  return `https://wa.me/${PHONE}?text=${encodeURIComponent(lines.join('\n'))}`;
}
