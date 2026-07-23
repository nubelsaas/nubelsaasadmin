// Taxonomía canónica de roles.type (clasificador INTERNO del sistema).
// Reforzada en BD por el CHECK constraint `roles_type_check`
// (nubelsaas/supabase/migrations/20260619000002_roles_type_check_constraint.sql).
//
// El `type` NO es traducible — la traducción/localización vive en `roles.name`,
// que es per-tenant. Estos 3 valores manejan la lógica del sistema:
//   operative      → staff/profesionales (aparecen en pickers de comisiones/POS)
//   administrative → administración (Administrador, Recepcionista…)
//   support        → personal de apoyo
//
// Única fuente de verdad para evitar magic-strings (el bug original fue teclear
// 'admin', que no existe en el sistema).
export const ROLE_TYPES = {
  OPERATIVE:      'operative',
  ADMINISTRATIVE: 'administrative',
  SUPPORT:        'support',
} as const;

export type RoleType = typeof ROLE_TYPES[keyof typeof ROLE_TYPES];
