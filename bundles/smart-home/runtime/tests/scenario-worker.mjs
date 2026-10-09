import { createBusinessEngine, seedSyntheticScenario } from '../index.mjs';
const engine = createBusinessEngine({ dataDir: process.argv[2], tenantId: 'depth-test-tenant', workspaceId: 'depth-test-workspace', clock: () => new Date('2026-10-09T01:00:00.000Z') });
try {
  const result = seedSyntheticScenario(engine, { anchorDate: '2026-10-09T01:00:00.000Z' });
  process.stdout.write(JSON.stringify({ replayed: result.replayed, eventId: result.receipt.eventId, readyTasks: result.counts.task }));
} finally { engine.close(); }
