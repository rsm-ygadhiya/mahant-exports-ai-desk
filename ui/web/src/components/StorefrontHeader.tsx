import Link from 'next/link';
import { getCurrentCustomer } from '@/lib/session';
import { prisma } from '@/lib/db';

export async function StorefrontHeader() {
  const customer = await getCurrentCustomer();
  const cartCount = customer
    ? await prisma.cartItem.count({ where: { customerId: customer.id } })
    : 0;

  return (
    <header className="border-b border-brand-100 bg-white sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-gold-400 to-gold-600
                          ring-2 ring-brand-700/20 flex items-center justify-center text-white font-serif">
            M
          </div>
          <div className="leading-tight">
            <div className="font-serif text-lg text-brand-900">Mahant Exports</div>
            <div className="text-[10px] uppercase tracking-widest text-gold-600">Lab Grown Diamonds</div>
          </div>
        </Link>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/diamonds" className="hover:text-gold-600">Stock</Link>
          {customer ? (
            <>
              <Link href="/cart" className="relative hover:text-gold-600">
                Cart{cartCount > 0 && (
                  <span className="ml-1 text-xs bg-gold-500 text-white rounded-full px-1.5 py-0.5">
                    {cartCount}
                  </span>
                )}
              </Link>
              <Link href="/account" className="hover:text-gold-600">{customer.companyName}</Link>
            </>
          ) : (
            <Link href="/login" className="btn-primary">Sign in</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
