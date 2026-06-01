import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SHAPES = ['Round', 'Princess', 'Cushion', 'Oval', 'Emerald', 'Pear', 'Marquise', 'Radiant', 'Heart', 'Asscher'];
const COLORS = ['D', 'E', 'F', 'G', 'H', 'I', 'J'];
const CLARITIES = ['FL', 'IF', 'VVS1', 'VVS2', 'VS1', 'VS2', 'SI1', 'SI2'];
const CUTS = ['EX', 'VG', 'GD'];
const FLUO = ['NON', 'FNT', 'MED', 'STR'];
const LABS = ['IGI', 'GIA', 'GCAL'];
const GROWTH = ['CVD', 'HPHT'] as const;

function r<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }

async function main() {
  // Roles — backfill the three system role templates with their default permissions.
  const { DEFAULT_PERMISSIONS } = await import('../src/lib/permissions');
  await prisma.role.upsert({
    where: { slug: 'owner' },
    update: { permissions: DEFAULT_PERMISSIONS.OWNER as any },
    create: { id: 'role_owner', name: 'Owner', slug: 'owner', isOwnerLike: true, isSystem: true, permissions: DEFAULT_PERMISSIONS.OWNER as any },
  });
  await prisma.role.upsert({
    where: { slug: 'sales' },
    update: { permissions: DEFAULT_PERMISSIONS.SALES as any },
    create: { id: 'role_sales', name: 'Sales', slug: 'sales', isSystem: true, permissions: DEFAULT_PERMISSIONS.SALES as any },
  });
  await prisma.role.upsert({
    where: { slug: 'accounts' },
    update: { permissions: DEFAULT_PERMISSIONS.ACCOUNTS as any },
    create: { id: 'role_accounts', name: 'Accounts', slug: 'accounts', isSystem: true, permissions: DEFAULT_PERMISSIONS.ACCOUNTS as any },
  });

  // admins — one of each role for testing
  const adminPwd = await bcrypt.hash('admin123', 10);
  await prisma.admin.upsert({
    where: { email: 'admin@mahant.test' },
    update: { role: 'OWNER', roleId: 'role_owner' },
    create: {
      email: 'admin@mahant.test',
      passwordHash: adminPwd,
      name: 'Owner Admin',
      role: 'OWNER',
      roleId: 'role_owner',
    },
  });

  const salesPwd = await bcrypt.hash('sales123', 10);
  await prisma.admin.upsert({
    where: { email: 'sales@mahant.test' },
    update: { role: 'SALES', roleId: 'role_sales', permissions: {} as any },
    create: {
      email: 'sales@mahant.test',
      passwordHash: salesPwd,
      name: 'Demo Sales',
      role: 'SALES',
      roleId: 'role_sales',
    },
  });

  const accountsPwd = await bcrypt.hash('accounts123', 10);
  await prisma.admin.upsert({
    where: { email: 'accounts@mahant.test' },
    update: { role: 'ACCOUNTS', roleId: 'role_accounts', permissions: {} as any },
    create: {
      email: 'accounts@mahant.test',
      passwordHash: accountsPwd,
      name: 'Demo Accounts',
      role: 'ACCOUNTS',
      roleId: 'role_accounts',
    },
  });

  // sample approved customer
  const custPwd = await bcrypt.hash('demo1234', 10);
  await prisma.customer.upsert({
    where: { mobile: '919999999991' },
    update: {},
    create: {
      mobile: '919999999991',
      email: 'buyer@demo.test',
      passwordHash: custPwd,
      companyName: 'Demo Diamonds Pvt Ltd',
      contactPerson: 'Ravi Patel',
      country: 'India',
      city: 'Surat',
      status: 'APPROVED',
      pricingRule: { create: { mode: 'BASE' } },
    },
  });

  // sample stones
  await prisma.diamond.deleteMany({ where: { stoneId: { startsWith: 'DEMO-' } } });
  const stones = Array.from({ length: 60 }, (_, i) => {
    const carat = +(0.3 + Math.random() * 4.5).toFixed(2);
    const ppc = Math.round(800 + Math.random() * 5000);
    return {
      stoneId: `DEMO-${String(i + 1).padStart(4, '0')}`,
      certificateNo: `LG${1000000 + i}`,
      lab: r(LABS),
      certificateUrl: `https://example.com/cert/LG${1000000 + i}.pdf`,
      videoUrl: `https://example.com/video/LG${1000000 + i}.mp4`,
      shape: r(SHAPES),
      carat: carat as any,
      color: r(COLORS),
      clarity: r(CLARITIES),
      cut: r(CUTS),
      polish: r(CUTS),
      symmetry: r(CUTS),
      fluorescence: r(FLUO),
      growthMethod: r(GROWTH),
      pricePerCarat: ppc as any,
      totalPrice: +(ppc * carat).toFixed(2) as any,
      currency: 'USD',
      location: r(['India', 'USA', 'HK', 'UAE']),
      status: 'AVAILABLE' as const,
    };
  });
  await prisma.diamond.createMany({ data: stones });

  // Message templates — system defaults. Upsert by `key` so the Owner's edits
  // persist on subsequent seed runs (we only force-write isSystem + name).
  const { DEFAULT_TEMPLATES } = await import('../src/lib/templates');
  for (const t of DEFAULT_TEMPLATES) {
    await prisma.messageTemplate.upsert({
      where: { key: t.key },
      update: { name: t.name, description: t.description, isSystem: true },
      create: {
        key: t.key, name: t.name, description: t.description,
        subject: t.subject, body: t.body, channel: t.channel, isSystem: true,
      },
    });
  }

  console.log('Seeded:', {
    admin: 'admin@mahant.test / admin123',
    customer: '919999999991 (mobile) — buyer@demo.test / demo1234',
    stones: stones.length,
    templates: DEFAULT_TEMPLATES.length,
  });
}

main().finally(() => prisma.$disconnect());
