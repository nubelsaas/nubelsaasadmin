export type CountryConfig = {
  name: string;
  flag: string;
  phonePrefix: string;
  currencyCode: string;
  timezone: string;
};

export const COUNTRIES: Record<string, CountryConfig> = {
  AR: { name: 'Argentina',   flag: '🇦🇷', phonePrefix: '+54',  currencyCode: 'ARS', timezone: 'America/Argentina/Buenos_Aires' },
  BO: { name: 'Bolivia',     flag: '🇧🇴', phonePrefix: '+591', currencyCode: 'BOB', timezone: 'America/La_Paz'         },
  BR: { name: 'Brasil',      flag: '🇧🇷', phonePrefix: '+55',  currencyCode: 'BRL', timezone: 'America/Sao_Paulo'      },
  CL: { name: 'Chile',       flag: '🇨🇱', phonePrefix: '+56',  currencyCode: 'CLP', timezone: 'America/Santiago'       },
  CO: { name: 'Colombia',    flag: '🇨🇴', phonePrefix: '+57',  currencyCode: 'COP', timezone: 'America/Bogota'         },
  CR: { name: 'Costa Rica',  flag: '🇨🇷', phonePrefix: '+506', currencyCode: 'CRC', timezone: 'America/Costa_Rica'     },
  DO: { name: 'Rep. Dom.',   flag: '🇩🇴', phonePrefix: '+1',   currencyCode: 'DOP', timezone: 'America/Santo_Domingo'  },
  EC: { name: 'Ecuador',     flag: '🇪🇨', phonePrefix: '+593', currencyCode: 'USD', timezone: 'America/Guayaquil'      },
  ES: { name: 'España',      flag: '🇪🇸', phonePrefix: '+34',  currencyCode: 'EUR', timezone: 'Europe/Madrid'          },
  GT: { name: 'Guatemala',   flag: '🇬🇹', phonePrefix: '+502', currencyCode: 'GTQ', timezone: 'America/Guatemala'      },
  HN: { name: 'Honduras',    flag: '🇭🇳', phonePrefix: '+504', currencyCode: 'HNL', timezone: 'America/Tegucigalpa'    },
  MX: { name: 'México',      flag: '🇲🇽', phonePrefix: '+52',  currencyCode: 'MXN', timezone: 'America/Mexico_City'    },
  NI: { name: 'Nicaragua',   flag: '🇳🇮', phonePrefix: '+505', currencyCode: 'NIO', timezone: 'America/Managua'        },
  PA: { name: 'Panamá',      flag: '🇵🇦', phonePrefix: '+507', currencyCode: 'PAB', timezone: 'America/Panama'         },
  PE: { name: 'Perú',        flag: '🇵🇪', phonePrefix: '+51',  currencyCode: 'PEN', timezone: 'America/Lima'           },
  PY: { name: 'Paraguay',    flag: '🇵🇾', phonePrefix: '+595', currencyCode: 'PYG', timezone: 'America/Asuncion'       },
  SV: { name: 'El Salvador', flag: '🇸🇻', phonePrefix: '+503', currencyCode: 'USD', timezone: 'America/El_Salvador'    },
  US: { name: 'USA',         flag: '🇺🇸', phonePrefix: '+1',   currencyCode: 'USD', timezone: 'America/New_York'       },
  UY: { name: 'Uruguay',     flag: '🇺🇾', phonePrefix: '+598', currencyCode: 'UYU', timezone: 'America/Montevideo'     },
  VE: { name: 'Venezuela',   flag: '🇻🇪', phonePrefix: '+58',  currencyCode: 'VES', timezone: 'America/Caracas'        },
};

// Sorted list for selects
export const COUNTRY_OPTIONS = Object.entries(COUNTRIES)
  .map(([iso, c]) => ({ iso, ...c }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function countryLabel(iso: string | null): string {
  const code = (iso ?? 'XX').toUpperCase();
  const c = COUNTRIES[code];
  return c ? `${c.flag} ${c.name}` : `🌐 ${code}`;
}

export function groupByCountry<T extends { country_iso: string | null }>(
  items: T[],
): { sortedCodes: string[]; groups: Record<string, T[]> } {
  const groups = items.reduce<Record<string, T[]>>((acc, item) => {
    const key = (item.country_iso ?? 'XX').toUpperCase();
    (acc[key] ??= []).push(item);
    return acc;
  }, {});
  return { sortedCodes: Object.keys(groups).sort(), groups };
}
