import { LoginForm } from './LoginForm';

export default function LoginPage() {
  return (
    <div className="max-w-md mx-auto py-16 px-4">
      <h1 className="font-serif text-3xl mb-2">Buyer sign in</h1>
      <p className="text-sm text-brand-700 mb-8">
        New buyers must be approved before prices are visible. We respond within 1 business day.
      </p>
      <LoginForm />
    </div>
  );
}
