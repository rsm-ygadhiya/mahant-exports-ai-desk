'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AdminLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    const res = await fetch('/api/admin/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    setLoading(false);
    if (!res.ok) { setError('Invalid email or password'); return; }
    router.push('/admin');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <div className="text-sm text-rose-700 bg-rose-50 p-2 rounded">{error}</div>}
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
  );
}
