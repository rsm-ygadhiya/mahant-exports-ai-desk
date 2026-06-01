import { StorefrontHeader } from '@/components/StorefrontHeader';

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StorefrontHeader />
      <main className="min-h-[calc(100vh-4rem)] bg-brand-50/40">
        {children}
      </main>
      <footer className="bg-brand-900 text-brand-100 py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 text-sm flex flex-col md:flex-row justify-between gap-4">
          <div>
            <div className="font-serif text-lg text-white">Mahant Exports</div>
            <div className="text-xs uppercase tracking-widest text-gold-400">Lab Grown Diamonds</div>
          </div>
          <div className="text-xs text-brand-200">
            © {new Date().getFullYear()} Mahant Exports. All rights reserved.
          </div>
        </div>
      </footer>
    </>
  );
}
