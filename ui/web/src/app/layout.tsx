import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mahant Exports — Lab Grown Diamonds',
  description: 'Premium lab-grown diamond stock. Search, view certificates, and send enquiries.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
