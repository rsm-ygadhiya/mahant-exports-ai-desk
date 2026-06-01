# Mahant Exports — Lab Grown Diamond Platform

B2B lab-grown diamond stock platform. Customers browse stock, view details, and send enquiries; admin manages stock, pricing, and customer access.

## Architecture

```
mahant/
├── web/          Next.js 14 (App Router) — storefront + admin panel + API
│   └── prisma/   PostgreSQL schema
├── mobile/       Flutter (Android + iOS) — phase 2
└── docs/         API contract, data model notes
```

One Next.js app serves three things:

| Path | Purpose |
|---|---|
| `/`, `/diamonds`, `/cart`, `/account`, `/login` | Storefront (customer-facing) |
| `/admin/...` | Admin panel (auth-guarded by middleware) |
| `/api/v1/...` (and `/api/admin/...`) | REST API consumed by the storefront and the future Flutter mobile app |

### Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 14 + TypeScript | Single deploy for web + admin + API. |
| UI | Tailwind + custom brand theme (navy + champagne gold) | Premium, no UI-kit lock-in. |
| Database | PostgreSQL + Prisma | Handles 20+ filter fields and per-customer pricing rules. |
| Auth (storefront) | JWT cookie + OTP via MSG91 (or email/password) | India-friendly OTP provider. |
| Auth (admin) | JWT cookie, edge-verified by `middleware.ts` | Admin panel guarded before every render. |
| Excel import | `xlsx` package — column-name tolerant upsert by `stoneId` | Real-world spreadsheets vary; we map aliases. |
| Storage (planned) | Cloudflare R2 | S3-compatible, no egress fees for cert/video URLs. |
| Push (planned) | FCM | Free; works for both Flutter (later) and web. |
| Hosting | Vercel + managed Postgres (Neon / Supabase / Railway) | One-click deploy. |

### Spec → implementation mapping

| Spec section | Where it lives |
|---|---|
| §2 Login (OTP / email+pwd / approval) | `app/(storefront)/login`, `app/api/auth/*` |
| §3 Diamond search filters | `app/(storefront)/diamonds`, `lib/diamondQuery.ts` |
| §4 Diamond list page | `app/(storefront)/diamonds/page.tsx` |
| §5 Diamond detail page | `app/(storefront)/diamonds/[id]/page.tsx` |
| §6 Cart + WhatsApp enquiry | `app/(storefront)/cart`, `lib/whatsapp.ts`, `app/api/enquiries` |
| §7 Admin dashboard | `app/admin/page.tsx` |
| §8 Excel stock upload | `app/admin/upload`, `lib/excelImport.ts` |
| §9 Customer-wise pricing | `lib/pricing.ts`, `prisma PricingRule` |
| §10 Hold / Sold / Available | `prisma DiamondStatus`, status filter on customer list |
| §11 Push notifications | `app/admin/notifications`, `prisma Notification` |
| §12 Branding | Tailwind config (`brand`, `gold`), `StorefrontHeader` logo mark |
| §13 Security | JWT cookies (httpOnly), bcrypt, middleware guard, Zod input validation |
| §15 V1 scope | All of the above ✅ |

## Getting started

```bash
cd web
cp .env.example .env          # set DATABASE_URL, JWT_SECRET, MAHANT_WHATSAPP_NUMBER
npm install
npx prisma migrate dev        # create schema
npm run seed                  # creates admin@mahant.test / admin123 + sample stock
npm run dev                   # → http://localhost:3000
```

Default credentials after seed:
- Admin panel — `http://localhost:3000/admin/login` — `admin@mahant.test` / `admin123`
- Sample buyer (mobile OTP) — `919999999991` (OTP prints to server console in dev)
- Sample buyer (email/password) — `buyer@demo.test` / `demo1234`

## Build phases

**Phase 1 — Foundation (this scaffold)**
- [x] Storefront: landing, login (OTP + email), filterable stock list, detail, cart, account
- [x] Admin: dashboard, stock CRUD, customer approval + pricing rules, enquiries, push, Excel import
- [x] API for the future Flutter app to consume the same backend

**Phase 2 — Productionize**
- Wire MSG91 OTP, Cloudflare R2 storage, FCM push (integration points are clearly marked in code)
- Branding pass: replace placeholder `M` logo mark, splash, app icon, full color tokens
- Pagination + virtualized list when stock crosses ~10k rows
- Email notifications on new enquiry / approval

**Phase 3 — Mobile + future features (spec §14)**
- Flutter mobile app reusing the existing API
- Invoice / memo / payment gateway / salesman login / RapNet sync / multi-currency

## API contract

See [`docs/api.md`](docs/api.md).
