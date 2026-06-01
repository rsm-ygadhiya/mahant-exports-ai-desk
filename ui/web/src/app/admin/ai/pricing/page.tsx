import { redirect } from 'next/navigation';

// The old standalone "AI pricing" page has been replaced by the full
// pricing workflow at /admin/pricing (Rap upload + draft proposals +
// per-stone approval + passcode-gated push to inventory).
export default function PricingRedirect() {
  redirect('/admin/pricing');
}
