import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasExtraUsers } from '../lib/cloneTarget.ts';

const owner = { permissions: { can_do_everything: true } };
const staff = { permissions: { can_view_sales: true } };

test('a tenant with only its bootstrap owner is empty', () => {
  assert.equal(hasExtraUsers([owner]), false);
  assert.equal(hasExtraUsers([]), false);
});

test('a single user who is not an owner counts as data', () => {
  assert.equal(hasExtraUsers([staff]), true);
});

test('a second user counts as data, even another owner', () => {
  assert.equal(hasExtraUsers([owner, staff]), true);
  assert.equal(hasExtraUsers([owner, owner]), true);
});

test('permissions stored as a JSON string are read', () => {
  assert.equal(hasExtraUsers([{ permissions: '{"can_do_everything":true}' }]), false);
});
