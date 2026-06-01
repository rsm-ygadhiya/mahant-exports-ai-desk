import { NewCustomerForm } from './NewCustomerForm';

export default function NewCustomerPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="font-serif text-3xl">Create buyer account</h1>
      <p className="text-sm text-brand-700">
        Add a buyer directly from the admin panel — useful for clients you onboard offline.
        The default status is <b>Approved</b>, so they can see prices on first login.
      </p>
      <NewCustomerForm />
    </div>
  );
}
