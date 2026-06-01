'use client';
import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }
  return <button onClick={logout} className="btn-outline">Sign out</button>;
}
