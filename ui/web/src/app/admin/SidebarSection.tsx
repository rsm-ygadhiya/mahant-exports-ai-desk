'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

/**
 * One collapsible group of nav items in the admin sidebar.
 *
 * Click the section label to toggle its items. Open/closed state is persisted
 * to localStorage keyed by the section label, so the admin's preference
 * survives page navigation and reloads.
 */
export function SidebarSection({
  label,
  items,
}: {
  label: string;
  items: Array<{ href: string; label: string }>;
}) {
  const storageKey = `admin.nav.${label}`;
  // Default to open. Hydration is safe because we only read localStorage in
  // useEffect after mount — the server renders open, then client may close.
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(storageKey);
      if (v === '0') setOpen(false);
      else if (v === '1') setOpen(true);
    } catch { /* localStorage might be unavailable */ }
  }, [storageKey]);

  function toggle() {
    setOpen(o => {
      const next = !o;
      try { window.localStorage.setItem(storageKey, next ? '1' : '0'); } catch {}
      return next;
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-2 mb-1.5 text-[10px] uppercase tracking-[0.18em] text-brand-300/70 hover:text-brand-100 transition"
      >
        <span>{label}</span>
        <span
          className={`inline-block transition-transform text-brand-300/60 ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ▸
        </span>
      </button>
      {open && (
        <ul className="space-y-0.5">
          {items.map(n => (
            <li key={n.href}>
              <Link
                href={n.href}
                className="block px-2 py-1.5 rounded text-brand-100 hover:bg-white/10 hover:text-white transition"
              >
                {n.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
