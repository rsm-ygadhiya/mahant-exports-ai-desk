import Link from 'next/link';
import { getCurrentAdmin } from '@/lib/session';
import { hasPermission, isOwner, NAV_ITEMS, type ModuleKey, type Action } from '@/lib/permissions';
import { SidebarSection } from './SidebarSection';
import { AIChatWidget } from './AIChatWidget';

// Auth is enforced by middleware.ts — by the time we render an /admin page
// (other than /admin/login) we're guaranteed to have a valid admin session.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getCurrentAdmin();

  if (!admin) {
    // /admin/login renders here when nobody is signed in.
    return <div className="min-h-screen bg-brand-50/40 flex items-center justify-center">{children}</div>;
  }

  const has = (m: ModuleKey, a: Action = 'view') => hasPermission(admin as any, m, a);
  const owner = isOwner(admin as any);
  const visible = NAV_ITEMS.filter(n => {
    if (n.ownerOnly && !owner) return false;
    return has(n.module, n.action ?? 'view');
  });

  // Group the (already permission-filtered) nav into the four logical sections.
  // Each section renders as a labelled block in the sidebar.
  const groups: Array<{ label: string; hrefs: Set<string> }> = [
    { label: 'Inventory', hrefs: new Set(['/admin', '/admin/diamonds', '/admin/pending-stock', '/admin/memo', '/admin/upload']) },
    { label: 'Sales',     hrefs: new Set(['/admin/sales', '/admin/sold', '/admin/customers', '/admin/enquiries']) },
    { label: 'Tools',     hrefs: new Set([
        '/admin/pricing',
        '/admin/ai/briefing',
        '/admin/ai/aging',
        '/admin/ai/memo',
        '/admin/ai/collections',
        '/admin/scintilla',
        '/admin/evals',
        '/admin/opportunities',
        '/admin/notifications',
      ]) },
    { label: 'Settings',  hrefs: new Set(['/admin/templates', '/admin/team', '/admin/audit']) },
  ];

  const sectioned = groups.map(g => ({
    label: g.label,
    items: visible.filter(n => g.hrefs.has(n.href)),
  })).filter(g => g.items.length > 0);

  // Catch any nav entry not in a known section (future-proofing).
  const known = new Set(groups.flatMap(g => Array.from(g.hrefs)));
  const orphans = visible.filter(n => !known.has(n.href));
  if (orphans.length > 0) sectioned.push({ label: 'Other', items: orphans });

  const roleLabel = admin.role === 'OWNER' ? 'Owner'
                  : admin.role === 'SALES' ? 'Sales'
                  : 'Accounts';
  const roleColor = admin.role === 'OWNER' ? 'bg-gold-500/30 text-gold-200'
                  : admin.role === 'SALES' ? 'bg-emerald-500/30 text-emerald-100'
                  : 'bg-rose-500/30 text-rose-100';

  return (
    <div className="min-h-screen bg-brand-50/40 flex">
      {/* ───── Sidebar ───── */}
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 bg-brand-900 text-white sticky top-0 self-start h-screen">
        <div className="px-5 pt-5 pb-4 border-b border-white/10">
          <Link href="/admin" className="font-serif text-lg block">Mahant Admin</Link>
          <p className="text-xs text-brand-300 mt-0.5">Operations panel</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4 text-sm">
          {sectioned.map(group => (
            <SidebarSection key={group.label} label={group.label} items={group.items} />
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-white/10 text-sm">
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-brand-100 truncate" title={admin.email}>{admin.name}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] uppercase tracking-widest ${roleColor} whitespace-nowrap`}>
              {roleLabel}
            </span>
          </div>
          <p className="text-xs text-brand-300 truncate mb-2" title={admin.email}>{admin.email}</p>
          <form action="/api/admin/logout" method="post">
            <button className="text-xs text-brand-300 hover:text-white">Sign out →</button>
          </form>
        </div>
      </aside>

      {/* ───── Mobile top bar (sidebar hidden under md) ───── */}
      <header className="md:hidden bg-brand-900 text-white sticky top-0 z-10">
        <div className="px-4 h-12 flex items-center justify-between">
          <Link href="/admin" className="font-serif">Mahant Admin</Link>
          <div className="flex items-center gap-2 text-xs">
            <span className={`px-2 py-0.5 rounded uppercase tracking-widest ${roleColor}`}>{roleLabel}</span>
            <form action="/api/admin/logout" method="post">
              <button className="text-brand-200 hover:text-white">Sign out</button>
            </form>
          </div>
        </div>
        {/* Mobile nav: simple horizontally-scrolling list. Sectioning gives up
            on this width for legibility; users with narrow screens are rare on
            an internal ops tool. */}
        <nav className="px-3 pb-2 flex gap-3 overflow-x-auto text-xs text-brand-100">
          {visible.map(n => (
            <Link key={n.href} href={n.href} className="hover:text-gold-400 whitespace-nowrap">{n.label}</Link>
          ))}
        </nav>
      </header>

      {/* ───── Main content ───── */}
      <main className="flex-1 min-w-0">
        <div className="max-w-7xl mx-auto px-4 py-8">{children}</div>
      </main>

      {/* Floating AI assistant — visible on every admin page when permitted */}
      <AIChatWidget enabled={has('ai_ask', 'run')} />
    </div>
  );
}
