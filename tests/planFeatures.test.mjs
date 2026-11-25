import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planDefault } from '../lib/planFeatures.ts';

test('a plan feature maps to its flag', () => {
  assert.equal(planDefault('enableGiftCards', { giftcards: false }), false);
  assert.equal(planDefault('enableScheduler', { appointments: true }), true);
});

test('flags outside the plan have no plan default', () => {
  assert.equal(planDefault('enableShifts', { tips: true }), undefined);
  assert.equal(planDefault('enableTips', null), undefined);
});

test('each mapped plan feature points back to its flag; unmapped ones have none', async () => {
  const { flagForPlanFeature } = await import('../lib/planFeatures.ts');
  assert.equal(flagForPlanFeature('giftcards'), 'enableGiftCards');
  assert.equal(flagForPlanFeature('appointments'), 'enableScheduler');
  for (const feature of ['staff_app', 'whatsapp_ia', 'multi_branch', 'electronic_billing']) {
    assert.equal(flagForPlanFeature(feature), undefined);
  }
});
