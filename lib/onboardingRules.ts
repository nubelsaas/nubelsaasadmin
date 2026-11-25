// Checklist de arranque de un salón: qué pasos ya hizo, a partir de lo que hay en la base.
// Sin dependencias: se prueba con node --test (tests/onboardingRules.test.mjs). La lectura está
// en lib/onboarding.ts.

export type StepKey =
  | 'owner_signed_in' | 'services' | 'payment_methods' | 'team'
  | 'customers' | 'first_appointment' | 'public_booking' | 'first_sale';

export type OnboardingStep = {
  key: StepKey;
  label: string;
  done: boolean;
  /** Opcional: no cuenta para el progreso (un salón de una sola persona no tiene equipo). */
  optional: boolean;
  /** Lo que se encontró, o qué falta. */
  detail: string;
  at: string | null;
};

export type OnboardingInput = {
  createdAt: string;
  schedulerOn: boolean;
  ownerLastSignIn: string | null;
  services: number;
  paymentMethods: number;
  activeUsers: number;
  customers: number;
  appointments: number;
  publicServices: number;
  sales: number;
  firstSaleAt: string | null;
};

export type OnboardingSummary = {
  steps: OnboardingStep[];
  done: number;
  total: number;
  complete: boolean;
  /** STUCK_DAYS o más desde el alta y todavía sin la primera venta: nunca arrancó. Un salón que
   *  vende pero no terminó otros pasos no está atascado, solo incompleto. */
  stuck: boolean;
  /** El primer paso que falta, para mostrarlo en la lista. */
  next: string | null;
  daysSinceCreated: number;
};

export const STUCK_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function onboardingSummary(input: OnboardingInput, now: number): OnboardingSummary {
  const steps: OnboardingStep[] = [
    {
      key: 'owner_signed_in', label: 'Owner signed in', optional: false,
      done: input.ownerLastSignIn !== null, at: input.ownerLastSignIn,
      detail: input.ownerLastSignIn ? 'An owner has signed in (date shown is the latest sign-in).' : 'No owner has signed in yet. Resend the invite from Users.',
    },
    {
      key: 'services', label: 'Services added', optional: false, done: input.services > 0, at: null,
      detail: input.services > 0 ? `${count(input.services, 'active service')}.` : 'No services yet: nothing to sell or book.',
    },
    {
      key: 'payment_methods', label: 'Payment methods set up', optional: false, done: input.paymentMethods > 0, at: null,
      detail: input.paymentMethods > 0 ? `${count(input.paymentMethods, 'payment method')}.` : 'No payment methods: the POS can\'t record a sale.',
    },
    {
      key: 'team', label: 'Team added', optional: true, done: input.activeUsers > 1, at: null,
      detail: input.activeUsers > 1 ? `${count(input.activeUsers, 'active user')}.` : 'Only the owner. Fine for a one-person salon.',
    },
    {
      key: 'customers', label: 'Customers added', optional: false, done: input.customers > 0, at: null,
      detail: input.customers > 0 ? `${count(input.customers, 'customer')}.` : 'No customers yet. They can be imported from a CSV.',
    },
  ];

  if (input.schedulerOn) {
    steps.push(
      {
        key: 'first_appointment', label: 'First appointment', optional: false, done: input.appointments > 0, at: null,
        detail: input.appointments > 0 ? `${count(input.appointments, 'appointment')}.` : 'The Scheduler is on but has no appointments.',
      },
      {
        key: 'public_booking', label: 'Public booking on', optional: false, done: input.publicServices > 0, at: null,
        detail: input.publicServices > 0
          ? `${count(input.publicServices, 'service')} bookable online.`
          : 'No services published for online booking: the booking link shows "Salón no encontrado".',
      },
    );
  }

  steps.push({
    key: 'first_sale', label: 'First sale', optional: false, done: input.sales > 0, at: input.firstSaleAt,
    detail: input.sales > 0 ? `${count(input.sales, 'sale')}.` : 'No sales yet.',
  });

  const required = steps.filter(s => !s.optional);
  const done = required.filter(s => s.done).length;
  const complete = done === required.length;
  const daysSinceCreated = Math.floor((now - new Date(input.createdAt).getTime()) / DAY_MS);
  return {
    steps,
    done,
    total: required.length,
    complete,
    stuck: input.sales === 0 && daysSinceCreated >= STUCK_DAYS,
    next: required.find(s => !s.done)?.label ?? null,
    daysSinceCreated,
  };
}
