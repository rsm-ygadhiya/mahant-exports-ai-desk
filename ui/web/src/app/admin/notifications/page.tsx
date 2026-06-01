import { prisma } from '@/lib/db';
import { NotificationForm } from './NotificationForm';

export const dynamic = 'force-dynamic';

export default async function AdminNotificationsPage() {
  const recent = await prisma.notification.findMany({ orderBy: { createdAt: 'desc' }, take: 20 });

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="font-serif text-3xl">Push Notifications</h1>
      <p className="text-sm text-brand-700">
        Send updates to mobile-app users — new stock, price revisions, special offers, fancy/big-size availability.
      </p>

      <NotificationForm />

      <div>
        <h2 className="font-serif text-xl mb-3">Recent</h2>
        <div className="space-y-2">
          {recent.map(n => (
            <div key={n.id} className="card p-3 text-sm">
              <div className="flex justify-between">
                <div className="font-medium">{n.title}</div>
                <div className="text-xs text-brand-700">
                  {new Date(n.createdAt).toLocaleString()}
                  {n.sentAt ? ' · sent' : ' · queued'}
                </div>
              </div>
              <div className="text-brand-700 mt-1">{n.body}</div>
            </div>
          ))}
          {recent.length === 0 && <p className="text-sm text-brand-700">No notifications sent yet.</p>}
        </div>
      </div>
    </div>
  );
}
