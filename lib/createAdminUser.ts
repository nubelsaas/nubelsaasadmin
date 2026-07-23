import { createAdminClient } from '@/lib/supabaseAdmin';
import { ROLE_TYPES } from '@/lib/roleTypes';

interface Options {
  tenantId: string;
  email: string;
  adminName?: string;
  password?: string;   // if provided → create with password; if omitted → send invite
  requireNew?: boolean; // if true → reject when the email already exists in auth.users
                        // (clone flow: the new superadmin must be a brand-new identity,
                        // exclusive to the new tenant). Default false keeps the legacy
                        // "reuse existing auth user" behaviour for the tenants/users page.
}

interface Result {
  ok: boolean;
  error?: string;
  roleId?: string;
  userId?: string;
}

export async function createAdminUserForTenant({ tenantId, email, adminName = '', password, requireNew = false }: Options): Promise<Result> {
  const db = createAdminClient();

  // 0. requireNew guard — reject up front if the email is already a registered
  //    auth identity. An email in Supabase Auth is globally unique and maps to a
  //    single tenant profile, so reusing it would tie one login to two tenants.
  if (requireNew) {
    const { data: { users: existingAuth }, error: listError } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (listError) return { ok: false, error: `Auth lookup failed: ${listError.message}` };
    const taken = existingAuth.some(u => u.email?.toLowerCase() === email.toLowerCase());
    if (taken) {
      return { ok: false, error: `El email ${email} ya está registrado como usuario. Usa un email nuevo para el administrador del clon.` };
    }
  }

  const nameParts = adminName.trim().split(/\s+/);
  const firstName = nameParts[0] || 'Administrador';
  const lastName  = nameParts.slice(1).join(' ') || '';

  // 1. Create admin role for this tenant.
  // type 'administrative' is the canonical admin role type (see nubelsaas
  // docs/operations/new_tenant.sql). 'operative' is for staff/professionals;
  // 'administrative' is excluded from commission/POS staff pickers.
  const roleId = crypto.randomUUID();
  const { error: roleError } = await db
    .from('roles')
    .insert({ id: roleId, tenant_id: tenantId, name: 'Administrador', type: ROLE_TYPES.ADMINISTRATIVE });

  if (roleError) return { ok: false, error: `Role creation failed: ${roleError.message}` };

  // 2. Create or invite auth user
  let authUserId: string;

  if (password) {
    // Manual creation with password — no invite email sent
    const { data: created, error: createError } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) {
      // Email already exists → reuse existing auth user
      if (createError.message?.includes('already been registered') || createError.status === 422) {
        const { data: { users }, error: listError } = await db.auth.admin.listUsers({ perPage: 1000 });
        if (listError) {
          await db.from('roles').delete().eq('id', roleId);
          return { ok: false, error: `Auth lookup failed: ${listError.message}` };
        }
        const existing = users.find(u => u.email === email);
        if (!existing) {
          await db.from('roles').delete().eq('id', roleId);
          return { ok: false, error: `User creation failed: ${createError.message}` };
        }
        authUserId = existing.id;
      } else {
        await db.from('roles').delete().eq('id', roleId);
        return { ok: false, error: `User creation failed: ${createError.message}` };
      }
    } else {
      authUserId = created.user.id;
    }
  } else {
    // Invite flow — user receives email to set their own password
    const { data: inviteData, error: inviteError } = await db.auth.admin.inviteUserByEmail(email, {
      redirectTo: process.env.MAIN_APP_URL ?? 'https://app.nubel.tech',
    });
    if (inviteError) {
      const { data: { users }, error: listError } = await db.auth.admin.listUsers({ perPage: 1000 });
      if (listError) {
        await db.from('roles').delete().eq('id', roleId);
        return { ok: false, error: `Auth lookup failed: ${listError.message}` };
      }
      const existing = users.find(u => u.email === email);
      if (!existing) {
        await db.from('roles').delete().eq('id', roleId);
        return { ok: false, error: `Invite failed: ${inviteError.message}` };
      }
      authUserId = existing.id;
    } else {
      authUserId = inviteData.user.id;
    }
  }

  // 3. Create users row
  const { error: userError } = await db.from('users').insert({
    id:                    authUserId,
    tenant_id:             tenantId,
    role_id:               roleId,
    first_name:            firstName,
    last_name:             lastName,
    email,
    permissions:           { can_do_everything: true },
    wage_type:             'monthly',
  });

  if (userError) {
    await db.from('roles').delete().eq('id', roleId);
    return { ok: false, error: `User creation failed: ${userError.message}` };
  }

  // 4. Record this admin as the tenant's admin_email when none is set yet.
  // The clone rollback and check-target use tenants.admin_email to identify the
  // real admin to preserve / exclude, so the new superadmin must be registered there.
  await db.from('tenants').update({ admin_email: email }).eq('id', tenantId).is('admin_email', null);

  return { ok: true, roleId, userId: authUserId };
}
