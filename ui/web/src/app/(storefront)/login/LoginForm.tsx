'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function emailLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (!res.ok) { setError('Invalid credentials'); return; }
    router.push('/diamonds');
    router.refresh();
  }

  return (
    <div className="card p-6">
      {error && <div className="mb-4 text-sm text-rose-700 bg-rose-50 p-2 rounded">{error}</div>}

      <form onSubmit={emailLogin} className="space-y-4">
        <label className="block">
          <span className="text-sm text-brand-700">Email</span>
          <input className="input mt-1" type="email" required value={email}
                 onChange={e => setEmail(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm text-brand-700">Password</span>
          <input className="input mt-1" type="password" required value={password}
                 onChange={e => setPassword(e.target.value)} />
        </label>
        <button className="btn-primary w-full" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-xs text-brand-700 mt-6">
        New buyer? Register with your email — we’ll approve your account within 1 business day.
      </p>
    </div>
  );
}
