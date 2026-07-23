import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabaseAdmin';
import { assertSuperadmin } from '@/lib/assertSuperadmin';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

const BATCH = 500;

// ── FK remapping (only tables touched by Onboarding clone) ────────────────────
const FK: Record<string, { col: string; ref: string }[]> = {
  commission_rules:  [{ col: 'role_id',              ref: 'roles' }],
  products_services: [{ col: 'category_id',          ref: 'product_categories' }],
  service_recipes:   [{ col: 'service_product_id',   ref: 'products_services' },
                      { col: 'supply_product_id',    ref: 'products_services' }],
  branch_stock:      [{ col: 'branch_id',            ref: 'branches' },
                      { col: 'product_id',           ref: 'products_services' }],
  users:             [{ col: 'branch_id',            ref: 'branches' },
                      { col: 'role_id',              ref: 'roles' }],
};

// ── Table insertion orders ────────────────────────────────────────────────────
// product_distributors is NOT here — it's handled separately (no tenant_id, composite PK).
// expense_categories is global (tenant_id IS NULL) — nothing to clone.
const ONBOARDING_ORDER = [
  'branches', 'roles', 'product_categories', 'distributors',
  'commission_rules', 'products_services', 'service_recipes',
  'branch_stock',
];

// ── Rollback order (reverse topological — children deleted before parents) ────
// Covers every table with tenant_id so a partial clone can be fully undone.
// product_distributors is deleted separately (no tenant_id — uses product_id join).
// expense_categories excluded — global rows must never be deleted by rollback.
const ROLLBACK_ORDER = [
  'transaction_payments', 'tips', 'sales', 'pos_quotes',
  'expenses_purchases', 'inventory_movements', 'payroll_advances_loans',
  'payrolls', 'attendance_records', 'bonification_records',
  'account_balance_entries', 'period_locks', 'customer_advances',
  'appointments', 'stylist_blocks',
  'cash_register_shifts', 'customers',
  'service_recipes', 'branch_stock',
  'products_services', 'commission_rules', 'users',
  'branches', 'roles', 'product_categories', 'distributors',
];

// Demo Seed clones catalog + users, then generates synthetic transactions
const DEMO_CLONE_ORDER = [...ONBOARDING_ORDER, 'users'];
// ── Pure-function transforms ──────────────────────────────────────────────────

function obfuscateUser(row: Record<string, unknown>, idx: number): Record<string, unknown> {
  return {
    ...row,
    first_name:      'Usuario',
    last_name:       String(idx + 1),
    alias:           null,
    email:           `usuario-${(row.id as string).slice(0, 8)}@demo.test`,
    phone:           null,
    document_type:   null,
    document_number: null,
    pos_pin:         null,
    payout_details:  null,   // clear bank account data — never copied
  };
}

function calcAttendancePay(user: Record<string, unknown>, daysWorked: number): number {
  const wageType = user.wage_type as string;
  if (wageType === 'monthly') return Number(user.base_salary)  || 0;
  if (wageType === 'daily')   return daysWorked * (Number(user.daily_rate) || 0);
  if (wageType === 'hourly')  return daysWorked * 8 * (Number(user.hourly_rate) || 0);
  return 0; // commission-only
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getWorkdaysForMonth(year: number, month: number): Date[] {
  // month is 1-indexed
  const days: Date[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getMonth() === month - 1) {
    if (d.getDay() !== 0) days.push(new Date(d)); // skip Sunday
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// ── Mock customers ────────────────────────────────────────────────────────────

const MOCK_FIRST = [
  'Valentina','Camila','Sofía','Isabella','Mariana','Daniela','Natalia','Alejandra','Fernanda','Gabriela',
  'Andrés','Santiago','Sebastián','Felipe','Nicolás','Julián','Carlos','David','Miguel','Alejandro',
  'Laura','Paola','Mónica','Andrea','Cristina','Lucía','Patricia','Claudia','Sandra','Juliana',
  'Diego','Javier','Roberto','Hernán','Pablo','Eduardo','Álvaro','Gustavo','Ricardo','Iván',
  'María','Silvia','Gloria','Elena','Verónica','Esperanza','Carmen','Rosa','Jimena','Pilar',
];
const MOCK_LAST = [
  'García','Martínez','López','González','Rodríguez','Sánchez','Pérez','Ramírez','Torres','Flores',
  'Rivera','Gómez','Díaz','Reyes','Cruz','Morales','Ortiz','Herrera','Vargas','Castillo',
  'Ramos','Jiménez','Ruiz','Álvarez','Romero','Mendoza','Gutiérrez','Aguilar','Molina','Rojas',
  'Suárez','Navarro','Vega','Cabrera','Ríos','Guerrero','Medina','Serrano','Domínguez','Blanco',
  'Delgado','Núñez','Santos','Castro','Soto','Mora','Fuentes','Lara','Ibáñez','León',
];

async function createMockCustomers(
  targetId: string,
  db: ReturnType<typeof createAdminClient>,
  send: (m: string) => void,
): Promise<{ id: string }[]> {
  const mocks = Array.from({ length: 50 }, (_, i) => ({
    id:         randomUUID(),
    tenant_id:  targetId,
    first_name: MOCK_FIRST[i % MOCK_FIRST.length],
    last_name:  MOCK_LAST[i  % MOCK_LAST.length],
    is_active:  true,
  }));
  const { error } = await db.from('customers' as any).insert(mocks as any);
  if (error) throw new Error(`Insert mock customers: ${error.message}`);
  send('✓  customers: 50 mock records');
  return mocks.map(m => ({ id: m.id }));
}

// ── Onboarding clone ──────────────────────────────────────────────────────────

// Tables whose rows must be deduplicated by `name` against the target tenant.
// Every tenant is bootstrapped with an admin role ("Administrador") at creation
// time, so cloning the source's roles would duplicate it. Instead, when the
// target already has a role with the same name, we remap the source role's FK
// references (commission_rules.role_id, users.role_id) to the existing target
// role rather than inserting a duplicate. Mirrors how the emptiness check already
// excludes the bootstrap admin user (see app/api/clone/check-target/route.ts).
const DEDUP_BY_NAME = new Set(['roles']);

async function runOnboarding(
  sourceId: string,
  targetId: string,
  order: string[],
  copyStock: boolean,
  send: (m: string) => void,
  db: ReturnType<typeof createAdminClient>,
) {
  send('📋 Building ID maps...');
  const idMaps: Record<string, Map<string, string>> = {};
  // source ids that map to a pre-existing target row (must NOT be re-inserted)
  const mergedIds: Record<string, Set<string>> = {};

  for (const table of order) {
    const map    = new Map<string, string>();
    const merged = new Set<string>();

    if (DEDUP_BY_NAME.has(table)) {
      const [{ data: srcRows, error: srcErr }, { data: tgtRows, error: tgtErr }] = await Promise.all([
        db.from(table as any).select('id, name').eq('tenant_id', sourceId),
        db.from(table as any).select('id, name').eq('tenant_id', targetId),
      ]);
      if (srcErr) throw new Error(`Read IDs ${table}: ${srcErr.message}`);
      if (tgtErr) throw new Error(`Read target ${table}: ${tgtErr.message}`);

      const tgtByName = new Map<string, string>();
      for (const r of (tgtRows ?? []) as { id: string; name: string }[]) {
        if (r.name != null) tgtByName.set(r.name, r.id);
      }
      for (const r of (srcRows ?? []) as { id: string; name: string }[]) {
        const existing = r.name != null ? tgtByName.get(r.name) : undefined;
        if (existing) { map.set(r.id, existing); merged.add(r.id); }
        else          { map.set(r.id, randomUUID()); }
      }
    } else {
      const { data, error } = await db.from(table as any).select('id').eq('tenant_id', sourceId);
      if (error) throw new Error(`Read IDs ${table}: ${error.message}`);
      for (const row of (data ?? []) as { id: string }[]) map.set(row.id, randomUUID());
    }

    idMaps[table]    = map;
    mergedIds[table] = merged;
  }

  let userIdx = 0;
  for (const table of order) {
    const idMap  = idMaps[table];
    const merged = mergedIds[table] ?? new Set<string>();
    const fks    = FK[table] ?? [];

    const { data, error } = await db.from(table as any).select('*').eq('tenant_id', sourceId);
    if (error) throw new Error(`Fetch ${table}: ${error.message}`);
    const allRows = (data ?? []) as Record<string, unknown>[];
    // Rows merged into a pre-existing target row are not re-inserted.
    const rows        = allRows.filter(row => !merged.has(row.id as string));
    const mergedCount = allRows.length - rows.length;

    if (!rows.length) {
      send(mergedCount ? `⏭  ${table}: ${mergedCount} merged into existing` : `⏭  ${table}: empty`);
      continue;
    }

    const transformed = rows.map(row => {
      let r = { ...row };
      r.id        = idMap.get(row.id as string)!;
      r.tenant_id = targetId;
      for (const { col, ref } of fks) {
        if (r[col] != null) r[col] = idMaps[ref]?.get(r[col] as string) ?? null;
      }
      if (table === 'users')             r = obfuscateUser(r, userIdx++);
      if (table === 'branch_stock' && !copyStock && 'current_stock' in r) r.current_stock = 0;
      return r;
    });

    for (let i = 0; i < transformed.length; i += BATCH) {
      const { error: e } = await db.from(table as any).insert(transformed.slice(i, i + BATCH) as any);
      if (e) throw new Error(`Insert ${table}: ${e.message}`);
    }
    send(`✓  ${table}: ${rows.length} rows` + (mergedCount ? ` (${mergedCount} merged)` : ''));
  }

}

// ── Demo Seed: read cloned structure ─────────────────────────────────────────

interface Branch   { id: string }
interface User     { id: string; branch_id: string | null; role_id: string; base_salary: number; wage_type: string; daily_rate: number; hourly_rate: number; can_receive_commissions: boolean }
interface Product  { id: string; price: number; cost_price: number; tax_pct: number }
interface ExpCat   { id: string; type: string }
interface DemoStructure {
  branches:    Branch[];
  users:       User[];
  products:    Product[];
  payAccount:  { id: string } | null;
  expCats:     ExpCat[];
}

async function readDemoStructure(targetId: string, db: ReturnType<typeof createAdminClient>): Promise<DemoStructure> {
  const { data: existingAccs } = await db
    .from('payment_accounts' as any)
    .select('id')
    .eq('tenant_id', targetId)
    .limit(1);

  if (!existingAccs || existingAccs.length === 0) {
    await db.from('payment_accounts' as any).insert({
      id: randomUUID(),
      tenant_id: targetId,
      name: 'Caja General',
      type: 'cash',
      is_default: true,
      is_pos_visible: true,
      current_balance: 0
    });
  }

  const [b, u, p, pa, ec] = await Promise.all([
    db.from('branches'          as any).select('id').eq('tenant_id', targetId).eq('is_active', true),
    db.from('users'             as any).select('id,branch_id,role_id,base_salary,wage_type,daily_rate,hourly_rate,can_receive_commissions').eq('tenant_id', targetId).eq('is_active', true),
    db.from('products_services' as any).select('id,price,cost_price,tax_pct').eq('tenant_id', targetId).eq('type', 'service').eq('is_active', true),
    db.from('payment_accounts'  as any).select('id').eq('tenant_id', targetId).eq('is_active', true).order('is_default', { ascending: false }).limit(1),
    db.from('expense_categories' as any).select('id,type').is('tenant_id', null).eq('is_active', true),
  ]);
  return {
    branches:   (b.data  ?? []) as Branch[],
    users:      (u.data  ?? []) as User[],
    products:   (p.data  ?? []) as Product[],
    payAccount: (pa.data ?? [])[0] ?? null,
    expCats:    (ec.data ?? []) as ExpCat[],
  };
}

// ── Demo Seed: generate one calendar month ────────────────────────────────────

async function generateMonth(
  targetId:   string,
  year:       number,
  month:      number,
  structure:  DemoStructure,
  customers:  { id: string }[],
  db:         ReturnType<typeof createAdminClient>,
  send:       (m: string) => void,
) {
  const label      = `${year}-${String(month).padStart(2, '0')}`;
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 0);     // last day
  const nextMonth  = new Date(year, month, 1);
  const workdays   = getWorkdaysForMonth(year, month);

  send(`📅 ${label} (${workdays.length} workdays)...`);

  if (!structure.products.length) { send(`   ⚠️  No service products — skipping ${label}`); return; }
  if (!structure.users.length)    { send(`   ⚠️  No active users — skipping ${label}`); return; }

  const salesPerBranch = Math.ceil(50 / Math.max(1, structure.branches.length));

  // ── Collect all rows for batch insert ──────────────────────────────────────
  const shifts:       Record<string, unknown>[] = [];
  const sales:        Record<string, unknown>[] = [];
  const payments:     Record<string, unknown>[] = [];
  const acctEntries:  Record<string, unknown>[] = [];

  for (const branch of structure.branches) {
    const branchUsers = structure.users.filter(u => !u.branch_id || u.branch_id === branch.id);
    const stylists    = branchUsers.filter(u => u.can_receive_commissions);
    const cashier     = branchUsers[0] ?? structure.users[0];
    if (!cashier) continue;

    let remaining = salesPerBranch;

    for (const day of workdays) {
      if (remaining <= 0) break;

      const shiftId = randomUUID();
      const openTime = new Date(day); openTime.setHours(8, 0, 0, 0);
      const closeTime = new Date(day); closeTime.setHours(19, 30, 0, 0);

      shifts.push({
        id: shiftId, tenant_id: targetId, branch_id: branch.id,
        opened_by_user_id: cashier.id, closed_by_user_id: cashier.id,
        opening_time: openTime.toISOString(), closing_time: closeTime.toISOString(),
        opening_base_cash: rand(50_000, 200_000),
        status: 'Closed',
      });

      const daySales = Math.min(remaining, Math.random() < 0.35 ? 2 : 1);
      for (let s = 0; s < daySales; s++) {
        const product  = structure.products[rand(0, structure.products.length - 1)];
        const stylist  = (stylists.length ? stylists : branchUsers)[rand(0, Math.max(0, (stylists.length || branchUsers.length) - 1))];
        const customer = customers[rand(0, customers.length - 1)];

        const saleTime = new Date(day);
        saleTime.setHours(rand(9, 18), rand(0, 59), 0, 0);

        const taxAmt   = Math.round((product.price * (product.tax_pct || 0)) / 100);
        const total    = product.price + taxAmt;
        const txId     = randomUUID();

        sales.push({
          id: randomUUID(), tenant_id: targetId, branch_id: branch.id,
          shift_id: shiftId, transaction_id: txId,
          date_time: saleTime.toISOString(),
          customer_id: customer.id,
          cashier_user_id: cashier.id,
          stylist_user_id: stylist?.id ?? null,
          product_id: product.id, quantity: 1,
          applied_unit_cost: product.cost_price || 0,
          base_price: product.price,
          tax_amount_charged: taxAmt,
          total_sale_price: total,
          applied_discount: 0, is_own_customer: false, status: 'open',
        });

        if (structure.payAccount) {
          payments.push({
            id: randomUUID(), tenant_id: targetId,
            transaction_id: txId, payment_account_id: structure.payAccount.id,
            amount_paid: total, date_time: saleTime.toISOString(),
            branch_id: branch.id, shift_id: shiftId,
          });
          acctEntries.push({
            id: randomUUID(), tenant_id: targetId,
            account_id: structure.payAccount.id, entry_type: 'pos_income',
            amount: total,
            description: `Ingreso POS · tx ${txId.slice(0, 8)}`,
            reference_date: day.toISOString().slice(0, 10),
            transaction_id: txId,
          });
        }
      }
      remaining -= daySales;
    }
  }

  // Batch inserts: shifts → sales (triggers fire) → payments → acct entries
  const batchInsert = async (table: string, rows: Record<string, unknown>[]) => {
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await db.from(table as any).insert(rows.slice(i, i + BATCH) as any);
      if (error) throw new Error(`Insert ${table} ${label}: ${error.message}`);
    }
  };

  await batchInsert('cash_register_shifts',  shifts);
  await batchInsert('sales',                 sales);       // ← triggers populate generated_commission
  await batchInsert('transaction_payments',  payments);
  await batchInsert('account_balance_entries', acctEntries);

  send(`   ✓ ${sales.length} sales, ${shifts.length} shifts`);

  // ── Query commissions populated by triggers ───────────────────────────────
  const { data: commData } = await db
    .from('sales' as any)
    .select('stylist_user_id, generated_commission')
    .eq('tenant_id', targetId)
    .gte('date_time', monthStart.toISOString())
    .lt('date_time',  nextMonth.toISOString());

  const commByUser: Record<string, number> = {};
  for (const row of (commData ?? []) as Record<string, unknown>[]) {
    const uid = row.stylist_user_id as string;
    if (uid) commByUser[uid] = (commByUser[uid] ?? 0) + (Number(row.generated_commission) || 0);
  }

  // ── Expenses ───────────────────────────────────────────────────────────────
  if (structure.expCats.length && structure.payAccount) {
    const mainBranch = structure.branches[0];
    const expRows:    Record<string, unknown>[] = [];
    const expEntries: Record<string, unknown>[] = [];
    const expDate = monthEnd.toISOString().slice(0, 10);

    for (const cat of structure.expCats) {
      const amount = cat.type === 'OPEX Fijo' ? rand(200_000, 600_000)
                   : cat.type === 'COGS'       ? rand(100_000, 400_000)
                   :                             rand(50_000,  300_000);
      expRows.push({
        id: randomUUID(), tenant_id: targetId, branch_id: mainBranch.id,
        expense_category_id: cat.id, payment_account_id: structure.payAccount.id,
        amount, description: 'Demo', date_incurred: expDate, status: 'paid',
      });
      expEntries.push({
        id: randomUUID(), tenant_id: targetId,
        account_id: structure.payAccount.id, entry_type: 'expense_payment',
        amount, description: 'Gasto operativo', reference_date: expDate,
      });
    }
    await batchInsert('expenses_purchases',    expRows);
    await batchInsert('account_balance_entries', expEntries);
    send(`   ✓ ${expRows.length} expenses`);
  }

  // ── Attendance records ────────────────────────────────────────────────────
  const periodStart = monthStart.toISOString().slice(0, 10);
  const periodEnd   = monthEnd.toISOString().slice(0, 10);
  const daysWorked  = workdays.length;

  const attendRows = structure.users.map(u => ({
    id: randomUUID(), tenant_id: targetId,
    branch_id: u.branch_id ?? structure.branches[0]?.id ?? null,
    user_id: u.id, period_start: periodStart, period_end: periodEnd,
    days_worked: daysWorked, hours_worked: daysWorked * 8,
    amount_to_pay: calcAttendancePay(u as unknown as Record<string, unknown>, daysWorked),
    status: 'approved',
  }));
  if (attendRows.length) {
    await batchInsert('attendance_records', attendRows);
    send(`   ✓ ${attendRows.length} attendance records`);
  }

  // ── Payrolls (net_to_pay = commissions from triggers + attendance pay) ────
  const payrollRows = structure.users.map(u => {
    const grossComm = commByUser[u.id] ?? 0;
    const attendPay = calcAttendancePay(u as unknown as Record<string, unknown>, daysWorked);
    return {
      id: randomUUID(), tenant_id: targetId, user_id: u.id,
      period_start: periodStart, period_end: periodEnd,
      total_gross_commissions: grossComm,
      total_retail_commissions: 0, total_tips: 0,
      total_supplies_deductions: 0, total_payment_fees_deductions: 0,
      total_assistant_deductions: 0, total_loan_installments: 0,
      net_to_pay: grossComm + attendPay,
      status: 'paid',
    };
  });
  if (payrollRows.length) {
    await batchInsert('payrolls', payrollRows);
    send(`   ✓ ${payrollRows.length} payrolls (total commissions: $${Math.round(Object.values(commByUser).reduce((a, b) => a + b, 0)).toLocaleString()})`);
  }
}

// ── Rollback ──────────────────────────────────────────────────────────────────

async function rollback(
  targetId: string,
  db: ReturnType<typeof createAdminClient>,
  send: (m: string) => void,
) {
  send('');
  send('⏪ Rolling back...');
  let total = 0;



  // The DB trigger trg_guard_last_superadmin (nubelsaas) ABORTS any users delete
  // that would leave the tenant with zero active superadmins while the tenant still
  // exists — and it has no session bypass. A bulk `DELETE WHERE email != admin_email`
  // therefore aborts whole when admin_email matches no real active superadmin (e.g.
  // a Demo Seed where the cloned staff are the only superadmins), leaving users behind.
  //
  // Fix: keep exactly ONE guardian row. Prefer the real admin (admin_email user that is
  // an active superadmin); otherwise keep any active superadmin so the delete never aborts.
  const { data: tenant } = await db
    .from('tenants')
    .select('admin_email')
    .eq('id', targetId)
    .single();
  const adminEmail: string | null = tenant?.admin_email ?? null;

  const { data: tenantUsers } = await db
    .from('users')
    .select('id, email, role_id, is_active, permissions')
    .eq('tenant_id', targetId);

  const isActiveSuperadmin = (u: { is_active?: boolean | null; permissions: unknown }) => {
    const perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions) : (u.permissions ?? {});
    return u.is_active !== false && (perms as Record<string, boolean>)?.can_do_everything === true;
  };

  const users = tenantUsers ?? [];
  const keeper =
    users.find(u => adminEmail && u.email?.toLowerCase() === adminEmail.toLowerCase() && isActiveSuperadmin(u))
    ?? users.find(isActiveSuperadmin)
    ?? null;
  const keeperRoleId: string | null = keeper?.role_id ?? null;

  if (keeper && (!adminEmail || keeper.email?.toLowerCase() !== adminEmail.toLowerCase())) {
    send(`⚠️  No real admin (admin_email) found — keeping superadmin "${keeper.email}" to satisfy the DB guard. Delete the tenant to fully empty it.`);
  }

  for (const table of ROLLBACK_ORDER) {
    let query = db.from(table as any).delete({ count: 'exact' }).eq('tenant_id', targetId);
    if (table === 'users' && keeper) {
      query = query.neq('id', keeper.id);
    }
    if (table === 'roles' && keeperRoleId) {
      query = query.neq('id', keeperRoleId);
    }
    const { count } = await query;
    if (count) { send(`   ✓ ${table}: ${count} rows removed`); total += count; }
  }
  send(`↩️  Rollback complete — ${total} rows removed.${keeper ? ' One guardian user kept.' : ' Target tenant is empty again.'}`);
}

// ── Orchestrators ─────────────────────────────────────────────────────────────

async function runOnboardingMode(
  sourceId: string, targetId: string, copyStock: boolean, excluded: Set<string>, send: (m: string) => void,
) {
  const db = createAdminClient();
  const { data: src } = await db.from('tenants').select('name').eq('id', sourceId).single();
  const { data: tgt } = await db.from('tenants').select('name').eq('id', targetId).single();
  if (!src) throw new Error(`Source tenant not found: ${sourceId}`);
  if (!tgt) throw new Error(`Target tenant not found: ${targetId}`);

  send(`Source : ${src.name}`);
  send(`Target : ${tgt.name}`);
  send(`Mode   : Onboarding`);
  if (excluded.size) send(`Skipped: ${Array.from(excluded).join(', ')}`);
  send('─'.repeat(40));

  const order = ONBOARDING_ORDER.filter(t => !excluded.has(t));
  await runOnboarding(sourceId, targetId, order, copyStock, send, db);

  send('─'.repeat(40));
  send('✅ Onboarding complete — tenant ready to operate');
}

async function runDemoSeedMode(
  sourceId: string, targetId: string, excluded: Set<string>, send: (m: string) => void,
) {
  const db = createAdminClient();
  const { data: src } = await db.from('tenants').select('name').eq('id', sourceId).single();
  const { data: tgt } = await db.from('tenants').select('name').eq('id', targetId).single();
  if (!src) throw new Error(`Source tenant not found: ${sourceId}`);
  if (!tgt) throw new Error(`Target tenant not found: ${targetId}`);

  send(`Source : ${src.name}`);
  send(`Target : ${tgt.name}`);
  send(`Mode   : Demo Seed`);
  if (excluded.size) send(`Skipped: ${Array.from(excluded).join(', ')}`);
  send('─'.repeat(40));

  // Phase 1: Clone catalog + users (obfuscated)
  send('── Phase 1: Onboarding (catalog + staff) ──');
  const order = DEMO_CLONE_ORDER.filter(t => !excluded.has(t));
  await runOnboarding(sourceId, targetId, order, false, send, db);

  // Phase 2: Read cloned structure
  const structure = await readDemoStructure(targetId, db);
  if (!structure.branches.length) throw new Error('No branches found after onboarding');

  // Phase 3: Create 50 mock customers
  send('── Phase 2: Mock customers ──');
  const customers = await createMockCustomers(targetId, db, send);

  // Phase 4: Generate 3 complete past months
  send('── Phase 3: Synthetic data (3 months) ──');
  const now = new Date();
  for (let offset = 3; offset >= 1; offset--) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    await generateMonth(targetId, d.getFullYear(), d.getMonth() + 1, structure, customers, db, send);
  }

  send('─'.repeat(40));
  send('✅ Demo Seed complete');
  send('ℹ️  Staff has no auth credentials — re-invite from the main app to activate accounts');
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!await assertSuperadmin()) return new Response('Forbidden', { status: 403 });

  const { searchParams } = new URL(req.url);
  const source    = searchParams.get('source');
  const target    = searchParams.get('target');
  const mode      = searchParams.get('mode') as 'onboarding' | 'demo' | 'rollback' | null;
  const copyStock = searchParams.get('copyStock') === '1';
  const excluded  = new Set((searchParams.get('exclude') ?? '').split(',').filter(Boolean));

  if (!target) return new Response('Missing target', { status: 400 });
  if (!source && mode !== 'rollback') return new Response('Missing source', { status: 400 });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (msg: string) =>
        controller.enqueue(new TextEncoder().encode(`data: ${msg}\n\n`));
      try {
        if (mode === 'rollback') {
          const db = createAdminClient();
          const { data: tgt } = await db.from('tenants').select('name').eq('id', target).single();
          if (!tgt) throw new Error(`Tenant not found: ${target}`);
          send(`Target : ${tgt.name}`);
          send(`Mode   : Rollback`);
          send('─'.repeat(40));
          await rollback(target, db, send);
        } else if (mode === 'demo') {
          await runDemoSeedMode(source!, target, excluded, send);
        } else {
          await runOnboardingMode(source!, target, copyStock, excluded, send);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(new TextEncoder().encode(`data: ❌ ${msg}\n\n`));
        if (mode !== 'rollback') await rollback(target, createAdminClient(), send);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}
