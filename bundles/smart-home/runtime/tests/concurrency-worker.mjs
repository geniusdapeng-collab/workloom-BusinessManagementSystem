import { createBusinessEngine } from '../index.mjs';
const [dataDir, action, key] = process.argv.slice(2);
const engine = createBusinessEngine({ dataDir, tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace', clock: () => new Date('2026-10-09T01:00:00.000Z') });
const actor = { id: 'synthetic-concurrent-worker', role: 'agent', channel: 'test', tenantId: 'synthetic-tenant', workspaceId: 'synthetic-workspace' };
try {
  const result = action === 'claim'
    ? engine.call('task.claim', { workflowId: 'synthetic-growth-flow', idempotencyKey: key }, actor)
    : engine.call('goal.create', { id: 'concurrent-goal', storeId: 'synthetic-store', title: 'Synthetic concurrent goal', metric: 'qualified-leads', target: 1, deadline: '2026-10-14T01:00:00.000Z', constraints: [], idempotencyKey: key }, actor);
  process.stdout.write(JSON.stringify({ ok: true, replayed: result.replayed, eventId: result.receipt.eventId }));
} catch (error) { process.stdout.write(JSON.stringify({ ok: false, code: error.code, message: error.message })); }
finally { engine.close(); }
