import { redirect } from 'next/navigation';
import { getCurrentAdmin } from '@/lib/session';
import { AdminLoginForm } from './AdminLoginForm';

// If the visitor is already signed in (e.g. clicking "Sign in" while a previous
// session is still live), bounce them straight to the dashboard — otherwise the
// admin layout would render the nav over the login form and reveal which
// account was last used.
export default async function AdminLoginPage() {
  const admin = await getCurrentAdmin();
  if (admin) redirect('/admin');

  return (
    <div className="card p-8 w-full max-w-sm">
      <h1 className="font-serif text-2xl mb-1">Mahant Admin</h1>
      <p className="text-sm text-brand-700 mb-6">Sign in to manage stock and customers.</p>
      <AdminLoginForm />
    </div>
  );
}
