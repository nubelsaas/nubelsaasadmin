// Descripciones que aparecen al pasar el mouse (o tocar ⓘ) sobre una etiqueta o campo de las
// páginas de Tenants. Un solo archivo para revisar el texto; las claves las usa <Hint id="…">.
// Cada texto sale de lo que hace el código, no de la etiqueta: si cambia la regla, cambiar aquí.

export const FIELD_HELP = {
  // ── Lista de tenants ──
  'list.search':        'Finds salons by name or contact email. Partial matches count.',
  'list.new':           'Creates a salon and its first owner. The owner gets an invite email.',
  'list.plan':          'Shows only salons on this plan. "No plan" finds salons with none assigned.',
  'list.status':        'Active salons work normally. Suspended salons are read-only.',
  'list.country':       'Shows only salons in this country. The list is grouped by country either way.',
  'list.health':        'Filters by health status, based on sales. "Needs attention" means audit log off, no active owner, or a contact email that belongs to a deactivated user.',
  'list.setup':         '"Incomplete" means required setup steps are missing. "Stuck" means 14 days or more with no first sale.',
  'list.sort':          'Order of salons inside each country group.',
  'badge.setup':        'Required setup steps done out of the total.',
  'badge.stuck':        'Created 14 days ago or more and still no sale: the salon never really started.',
  'badge.attention':    'Audit log off, no active owner, or the contact email belongs to a deactivated user.',
  'health.active':      'Sold in the last 14 days, and revenue is not down by half against the 30 days before.',
  'health.quiet':       'No sale in the last 14 days.',
  'health.declining':   'Last 30 days of revenue are less than half of the 30 days before.',
  'health.new':         'Has never recorded a sale.',
  'health.suspended':   'Suspended from this portal: read-only, no public booking, WhatsApp or reminders.',

  // ── Salón: números ──
  'stats.users':        'Active users only (deactivated ones are not counted). Opens the users page.',
  'stats.customers':    'All customers in the salon’s records.',
  'stats.branches':     'Active branches only.',
  'stats.lastSale':     'Date of the most recent sale (transaction).',

  // ── Salón: accesos rápidos ──
  'link.flags':         'Turn screens on or off for this salon, on top of what its plan includes.',
  'link.impersonate':   'Open the app as one of the salon’s users for support. Needs a reason, is logged, and ends after 60 minutes.',
  'link.clone':         'Copy a template’s catalog into this salon, or fill it with demo data.',
  'link.audit':         'Everything done to this salon from the portal, with who did it and why.',
  'link.openApp':       'Opens the salon app in a new tab, with your own session (not as the salon).',

  // ── Salón: tarjetas ──
  'card.notes':         'Internal notes for the support team. The salon never sees them. Pinned notes stay on top.',
  'card.setup':         'Setup checklist, worked out from the salon’s data. Optional steps don’t count toward progress.',
  'card.integrations':  'Health of email, WhatsApp, Google Calendar and push notifications, from their recent delivery records.',
  'card.timeline':      'Everything that happened to this salon in one list: portal actions, notes, support sessions and announcements. Opening it is logged.',
  'integration.level':  'Working: no recent failures. Check: some failures. Failing: not delivering. Off: not set up. N/A: not available in this database.',
  'card.booking':       'The salon’s public page where customers book online. Works only once the salon publishes at least one service.',

  // ── Salón: info ──
  'info.id':            'The salon’s internal ID. Use it when searching logs or the database.',
  'info.name':          'The salon’s business name, as shown in the app.',
  'info.city':          'City the salon gave at sign-up. For reference only.',
  'info.phone':         'The salon’s contact phone. For reference only.',
  'info.country':       'Country code (ISO). Decides currency, timezone and phone prefix.',

  // ── Salón: configuración ──
  'settings.adminEmail':  'The salon’s contact email. Cash alerts go here. Changing it does not change anyone’s login.',
  'settings.country':     'Sets currency, timezone and phone prefix together. Locked once the salon has sales, expenses or account entries.',
  'settings.currency':    'Comes from the country. Every amount in the salon is in this currency.',
  'settings.timezone':    'Comes from the country. Decides when the salon’s day starts and ends in reports and cash closings.',
  'settings.phonePrefix': 'Comes from the country. The default prefix when staff enter customer phone numbers.',
  'settings.plan':        'Decides which screens the salon sees by default. It hides screens but does not block the features in the database.',
  'settings.logo':        'Shown in the app’s sidebar and on the public booking page. PNG, JPG or WebP.',

  // ── Salón: acciones ──
  'action.export':      'Downloads a ZIP of CSV files with the salon’s records. Contains personal data; asks for a reason and is logged.',
  'action.suspend':     'Makes the salon read-only and stops public booking, WhatsApp and reminders. Support chat stays on. Needs a reason; undo with Reactivate.',
  'action.template':    'Templates are the only salons Clone can copy from. Their catalog, costs and suppliers get copied, so never mark a real salon.',
  'action.delete':      'Permanently removes an empty salon and its users’ logins. Salons with any data are refused.',

  // ── Crear tenant ──
  'create.name':        'The salon’s business name, as shown in the app. Can be changed later.',
  'create.country':     'Sets currency, timezone and phone prefix. Hard to change later: it locks once the salon records money.',
  'create.city':        'For reference only.',
  'create.adminEmail':  'Becomes the first owner’s login and the salon’s contact email. They get an invite to set a password.',
  'create.adminName':   'Name of the first owner, shown in the app.',
  'create.phone':       'The salon’s contact phone. For reference only.',
  'create.plan':        'Decides which screens the salon sees. Can be changed later.',

  // ── Usuarios del salón ──
  'users.role':         'The user’s role in the salon. Roles and their permissions are managed in the app.',
  'users.admin':        'Owner: full access to everything in this salon.',
  'users.inactive':     'Deactivated: can’t log in. Their sales and appointments stay.',
  'users.resendInvite': 'Sends the invite email again. Useful when the first one expired or never arrived. Logged.',
  'users.magicLink':    'Creates a one-time sign-in link and shows it here to copy. No email is sent. Treat it like a password. Logged.',
  'users.makeOwner':    'Gives full access to this salon. Needs a reason and is logged.',
  'users.deactivate':   'Stops the user from logging in. Their records stay. The only owner can’t be deactivated.',
  'users.reactivate':   'Lets a deactivated user log in again.',
  'users.addMode':      'Send invite: they set their own password from an email. Create manually: you set the password and no email is sent.',
} as const;

export type HelpKey = keyof typeof FIELD_HELP;
