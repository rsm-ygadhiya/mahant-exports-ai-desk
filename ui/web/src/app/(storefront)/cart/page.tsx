import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getCurrentCustomer } from '@/lib/session';
import { applyPricing } from '@/lib/pricing';
import { fmtCarat, fmtUsd } from '@/lib/format';
import { CartActions } from './CartActions';

export const dynamic = 'force-dynamic';

export default async function CartPage() {
  const customer = await getCurrentCustomer();
  if (!customer) redirect('/login');

  const cart = await prisma.cartItem.findMany({
    where: { customerId: customer.id },
    include: { diamond: true },
    orderBy: { addedAt: 'desc' },
  });

  const priced = cart.map(c => ({
    ...c,
    priced: applyPricing(c.diamond, customer, customer.pricingRule ?? null),
  }));

  const totalCarat = priced.reduce((s, c) => s + Number(c.diamond.carat), 0);
  const totalAmount = priced.reduce(
    (s, c) => s + (c.priced.priceHidden ? 0 : Number(c.priced.totalPrice ?? 0)),
    0,
  );
  const anyHidden = priced.some(c => c.priced.priceHidden);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="font-serif text-3xl mb-2">Your Cart</h1>
      <p className="text-sm text-brand-700 mb-6">
        Review selected stones and send a single enquiry.
      </p>

      {priced.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-brand-700">Your cart is empty.</p>
          <Link href="/diamonds" className="btn-primary mt-4">Browse stock</Link>
        </div>
      ) : (
        <>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-brand-50 text-brand-700 text-left">
                <tr>
                  <th className="px-3 py-2">Stone</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Carat</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {priced.map(({ diamond, priced }) => (
                  <tr key={diamond.id} className="border-t border-brand-100">
                    <td className="px-3 py-2 font-mono text-xs">
                      <Link href={`/diamonds/${diamond.id}`} className="text-brand-700 hover:text-gold-600">
                        {diamond.stoneId}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {diamond.shape} · {diamond.color} {diamond.clarity} · {diamond.lab} {diamond.certificateNo}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtCarat(diamond.carat as any)}</td>
                    <td className="px-3 py-2 text-right">
                      {priced.priceHidden ? <span className="text-xs text-brand-700">Enquire</span>
                                          : fmtUsd(priced.totalPrice as any)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <RemoveBtn diamondId={diamond.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-brand-50">
                <tr>
                  <td colSpan={2} className="px-3 py-3 text-right font-medium">Totals</td>
                  <td className="px-3 py-3 text-right font-medium">{totalCarat.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right font-medium">
                    {anyHidden ? `${fmtUsd(totalAmount)} + enquire` : fmtUsd(totalAmount)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="card p-6 mt-4">
            <p className="text-sm text-brand-700 mb-2">
              Buyer: <span className="text-brand-900 font-medium">{customer.companyName}</span> ({customer.contactPerson})
            </p>
            <CartActions diamondIds={priced.map(p => p.diamond.id)} />
          </div>
        </>
      )}
    </div>
  );
}

function RemoveBtn({ diamondId }: { diamondId: string }) {
  return (
    <form action={async () => {
      'use server';
      const { prisma } = await import('@/lib/db');
      const { getCustomerSession } = await import('@/lib/session');
      const session = await getCustomerSession();
      if (!session) return;
      await prisma.cartItem.deleteMany({ where: { customerId: session.sub, diamondId } });
      const { revalidatePath } = await import('next/cache');
      revalidatePath('/cart');
    }}>
      <button className="text-xs text-rose-600 hover:underline">Remove</button>
    </form>
  );
}
