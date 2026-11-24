import test from 'node:test';
import assert from 'node:assert/strict';
import { supplyDelegatedUserId } from './supplyDelegation.js';

test('supply delegation is one way and fails closed for ambiguous accounts', async () => {
  let calls = 0;
  const prisma = { user: { findMany: async () => { calls++; return [{ id: 42 }]; } } };
  assert.equal(await supplyDelegatedUserId(prisma, { username: 'balouchi' }), 42);
  assert.equal(await supplyDelegatedUserId(prisma, { username: 'esmaeili' }), null);
  assert.equal(await supplyDelegatedUserId(prisma, { username: 'other' }), null);
  assert.equal(calls, 1);
  prisma.user.findMany = async () => [{ id: 42 }, { id: 43 }];
  assert.equal(await supplyDelegatedUserId(prisma, { username: 'balouchi' }), null);
  prisma.user.findMany = async () => [];
  assert.equal(await supplyDelegatedUserId(prisma, { username: 'balouchi' }), null);
});
