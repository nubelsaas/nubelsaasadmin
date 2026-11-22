import type { SupabaseClient } from '@supabase/supabase-js';
import { strToU8, zipSync } from 'fflate';

const PAGE_SIZE = 1000;

export type ExportSpec = {
  file: string;
  table: string;
  description: string;
  columns: string[];
  idColumn?: 'id' | 'tenant_id';
  activeOnly?: boolean;
};

// Lista permitida: una tabla o columna nueva no sale hasta que alguien la revise.
// Fuera a propósito: pos_pin, payout_details, documentos del staff, permisos, tokens, códigos de
// autorización de pagos, audit logs, trazas del asistente y chats de soporte.
// Toda columna debe existir en PROD y en DEV. Estado, sede y fecha de una venta viven en
// `transactions`, no en `sales`.
export const EXPORT_SPECS: ExportSpec[] = [
  {
    file: 'empresa', table: 'tenants', idColumn: 'tenant_id', description: 'Datos del negocio',
    columns: ['id', 'name', 'legal_name', 'tax_id', 'tax_verification_code', 'tax_regime_code', 'economic_activity_code', 'fiscal_address', 'city', 'country_iso', 'phone_prefix', 'currency_code', 'timezone', 'payroll_frequency', 'prices_include_tax', 'is_tax_exempt', 'default_tax_rate', 'admin_email', 'phone', 'website_url', 'created_at'],
  },
  { file: 'sedes', table: 'branches', description: 'Sedes', columns: ['id', 'name', 'address', 'is_active', 'created_at'] },
  { file: 'roles', table: 'roles', description: 'Roles del equipo', columns: ['id', 'name', 'type'] },
  {
    file: 'equipo', table: 'users', description: 'Equipo, sin números de documento ni datos bancarios',
    columns: ['id', 'branch_id', 'role_id', 'first_name', 'last_name', 'alias', 'email', 'phone', 'hire_date', 'base_salary', 'wage_type', 'daily_rate', 'hourly_rate', 'can_receive_commissions', 'is_active', 'created_at'],
  },
  {
    file: 'clientes', table: 'customers', activeOnly: true, description: 'Clientes, sin los eliminados',
    columns: ['id', 'first_name', 'middle_name', 'last_name', 'second_last_name', 'document_type', 'document_number', 'phone', 'email', 'address', 'birthday', 'instagram_user', 'acquisition_source', 'belongs_to_user_id', 'is_active', 'special_attention_tags', 'internal_notes', 'messaging_consent', 'consent_at', 'consent_source', 'data_consent_at', 'data_consent_source', 'created_at'],
  },
  { file: 'categorias', table: 'product_categories', description: 'Categorías del catálogo', columns: ['id', 'name', 'type'] },
  {
    file: 'catalogo', table: 'products_services', description: 'Servicios y productos',
    columns: ['id', 'category_id', 'name', 'sku', 'sku_vendor', 'brand', 'type', 'price', 'tax_pct', 'cost_price', 'special_commission_house', 'special_commission_own', 'expected_yield', 'is_active'],
  },
  { file: 'inventario', table: 'branch_stock', description: 'Existencias por sede', columns: ['id', 'branch_id', 'product_id', 'current_stock', 'min_stock_alert'] },
  { file: 'proveedores', table: 'distributors', description: 'Proveedores', columns: ['id', 'name', 'contact_name', 'email', 'phone', 'nit', 'is_active'] },
  {
    file: 'comisiones', table: 'commission_rules', description: 'Reglas de comisión',
    columns: ['id', 'role_id', 'base_house_commission_pct', 'base_own_commission_pct', 'retail_commission_pct', 'assistant_fee_stylist_pct', 'supplies_deduction_pct', 'bank_fee_assumption_pct', 'assistant_base_fee'],
  },
  {
    file: 'ventas', table: 'transactions', description: 'Ventas, una fila por ticket',
    columns: ['id', 'branch_id', 'customer_id', 'cashier_user_id', 'shift_id', 'appointment_id', 'invoice_prefix', 'invoice_number', 'status', 'date_time', 'total_sale_price', 'voided_at', 'void_reason', 'voided_tip_amount', 'created_at'],
  },
  {
    file: 'ventas_detalle', table: 'sales', description: 'Ítems de cada venta; se une a ventas por transaction_id',
    columns: ['id', 'transaction_id', 'customer_id', 'cashier_user_id', 'stylist_user_id', 'assistant_user_id', 'product_id', 'quantity', 'applied_unit_cost', 'base_price', 'tax_amount_charged', 'total_sale_price', 'applied_discount', 'is_own_customer', 'generated_commission', 'gross_commission', 'assistant_deduction', 'bank_fee_deduction'],
  },
  {
    file: 'pagos', table: 'transaction_payments', description: 'Pagos de las ventas',
    columns: ['id', 'transaction_id', 'payment_account_id', 'amount_paid', 'date_time', 'branch_id', 'shift_id', 'customer_advance_id'],
  },
  { file: 'propinas', table: 'tips', description: 'Propinas', columns: ['id', 'transaction_id', 'user_id', 'payment_account_id', 'amount', 'date_time', 'branch_id', 'shift_id'] },
  {
    file: 'cuentas', table: 'payment_accounts', description: 'Cuentas y medios de pago',
    columns: ['id', 'branch_id', 'name', 'type', 'is_default', 'is_active', 'current_balance', 'real_balance', 'gateway_fee_pct', 'gateway_fee_fixed'],
  },
  {
    file: 'movimientos_cuentas', table: 'account_balance_entries', description: 'Movimientos de las cuentas',
    columns: ['id', 'entry_type', 'account_id', 'related_account_id', 'amount', 'description', 'reference_date', 'transaction_id', 'shift_id', 'created_at'],
  },
  {
    file: 'turnos_caja', table: 'cash_register_shifts', description: 'Turnos de caja',
    columns: ['id', 'branch_id', 'opened_by_user_id', 'closed_by_user_id', 'opening_time', 'closing_time', 'opening_base_cash', 'expected_cash', 'actual_counted_cash', 'cash_difference', 'status', 'notes'],
  },
  {
    file: 'gastos', table: 'expenses_purchases', description: 'Gastos y compras',
    columns: ['id', 'branch_id', 'expense_category_id', 'payment_account_id', 'amount', 'subtotal', 'tax_amount', 'description', 'supplier_name', 'invoice_ref', 'invoice_issue_date', 'date_incurred', 'due_date', 'status', 'created_at'],
  },
  {
    file: 'movimientos_inventario', table: 'inventory_movements', description: 'Movimientos de inventario',
    columns: ['id', 'branch_id', 'product_id', 'movement_type', 'quantity', 'reason', 'stylist_id', 'total_cost', 'notes', 'created_at'],
  },
  {
    file: 'citas', table: 'appointments', description: 'Citas',
    columns: ['id', 'branch_id', 'customer_id', 'stylist_user_id', 'start_time', 'end_time', 'status', 'requested_services', 'notes', 'source', 'confirmation_status', 'confirmed_at', 'created_at'],
  },
  {
    file: 'anticipos_giftcards', table: 'customer_advances', description: 'Anticipos y gift cards',
    columns: ['id', 'customer_id', 'payment_account_id', 'type', 'code', 'initial_amount', 'current_balance', 'status', 'branch_id', 'notes', 'created_at'],
  },
  {
    file: 'nomina', table: 'payrolls', description: 'Nómina',
    columns: ['id', 'user_id', 'period_start', 'period_end', 'total_gross_commissions', 'total_retail_commissions', 'total_tips', 'total_supplies_deductions', 'total_payment_fees_deductions', 'total_assistant_deductions', 'total_loan_installments', 'net_to_pay', 'status', 'notes', 'created_at'],
  },
  {
    file: 'prestamos_adelantos', table: 'payroll_advances_loans', description: 'Préstamos y adelantos al equipo',
    columns: ['id', 'branch_id', 'user_id', 'type', 'total_amount', 'remaining_amount', 'installments_total', 'installments_paid', 'status', 'notes', 'date_issued', 'payment_start_date'],
  },
  {
    file: 'asistencia', table: 'attendance_records', description: 'Asistencia',
    columns: ['id', 'branch_id', 'user_id', 'period_start', 'period_end', 'days_worked', 'hours_worked', 'amount_to_pay', 'status', 'notes'],
  },
  { file: 'bonificaciones', table: 'bonification_records', description: 'Bonificaciones', columns: ['id', 'branch_id', 'user_id', 'period_start', 'period_end', 'amount', 'notes'] },
];

// Un cliente puede escribir su nombre en la reserva pública: sin esto, Excel ejecutaría una fórmula.
function protectFormula(value: string) {
  if (/^[+-]?[\d\s().]+$/.test(value)) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function toCell(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  const text = protectFormula(typeof value === 'object' ? JSON.stringify(value) : String(value));
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** La marca BOM hace que Excel lea bien los acentos. */
export function toCsv(columns: string[], rows: Record<string, unknown>[]) {
  const lines = rows.map(row => columns.map(column => toCell(row[column])).join(','));
  return `﻿${[columns.join(','), ...lines].join('\r\n')}\r\n`;
}

/** Lee todas las filas o falla: una tabla incompleta no puede salir como si estuviera completa. */
export async function readAllRows(db: SupabaseClient, spec: ExportSpec, tenantId: string) {
  const rows: Record<string, unknown>[] = [];

  while (true) {
    let query = db
      .from(spec.table)
      .select(spec.columns.join(','), { count: 'exact' })
      .eq(spec.idColumn === 'tenant_id' ? 'id' : 'tenant_id', tenantId);
    if (spec.activeOnly) query = query.is('deleted_at', null);

    const { data, count, error } = await query.order('id').range(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not read ${spec.table}: ${error.message}`);

    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (rows.length >= (count ?? 0)) {
      if (rows.length !== count) throw new Error(`Incomplete read of ${spec.table}: ${rows.length} of ${count}`);
      return rows;
    }
    if (page.length === 0) throw new Error(`Incomplete read of ${spec.table}: ${rows.length} of ${count}`);
  }
}

function buildReadme(tenantName: string, exportedAt: Date, counts: Record<string, number>) {
  const files = EXPORT_SPECS.map(spec => `${spec.file}.csv (${counts[spec.file]} filas): ${spec.description}`);
  return [
    `Exportación de datos de ${tenantName}`,
    `Generada: ${exportedAt.toISOString()}`,
    '',
    'Los archivos están en CSV (UTF-8) y se relacionan por sus columnas id.',
    'Un apóstrofe al inicio de un valor evita que Excel lo interprete como fórmula.',
    '',
    'Archivos:',
    ...files,
    '',
    'No se incluyen:',
    'Fotos ni adjuntos de clientes y citas.',
    'Números de documento, PIN, datos bancarios ni permisos del equipo.',
    'Clientes eliminados, historial de auditoría, conversaciones de soporte ni del asistente.',
    '',
    'Este archivo contiene datos personales: guárdalo y compártelo con cuidado.',
    '',
  ].join('\r\n');
}

export function buildExportZip(
  tenantName: string,
  tables: Record<string, Record<string, unknown>[]>,
  exportedAt = new Date(),
) {
  const counts = Object.fromEntries(EXPORT_SPECS.map(spec => [spec.file, tables[spec.file].length]));
  const files = Object.fromEntries(
    EXPORT_SPECS.map(spec => [`${spec.file}.csv`, strToU8(toCsv(spec.columns, tables[spec.file]))])
  );
  return { counts, zip: zipSync({ ...files, 'LEEME.txt': strToU8(buildReadme(tenantName, exportedAt, counts)) }) };
}
