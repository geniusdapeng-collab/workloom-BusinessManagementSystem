import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BusinessError, assert, canonical, digest, clone } from './errors.mjs';

export class BusinessStorage {
  constructor({ dataDir, tenantId, workspaceId, dataMode, now }) {
    this.tenantId = tenantId;
    this.workspaceId = workspaceId;
    this.dataMode = dataMode;
    this.now = now;
    this.changes = null;
    this.fences = null;
    try {
      const folder = resolve(dataDir);
      assert(!existsSync(folder) || !lstatSync(folder).isSymbolicLink(), 'UNSAFE_DATA_PATH', 'dataDir must not be a symbolic link');
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      this.path = join(folder, 'business.sqlite');
      assert(!existsSync(this.path) || !lstatSync(this.path).isSymbolicLink(), 'UNSAFE_DATA_PATH', 'database must not be a symbolic link');
      this.db = new DatabaseSync(this.path, { timeout: 5000, enableForeignKeyConstraints: true, allowExtension: false });
      chmodSync(this.path, 0o600);
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA trusted_schema = OFF;
        CREATE TABLE IF NOT EXISTS scope_registry (
          tenant TEXT NOT NULL, workspace TEXT NOT NULL, data_mode TEXT NOT NULL,
          PRIMARY KEY (tenant, workspace)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS entities (
          tenant TEXT NOT NULL, workspace TEXT NOT NULL, type TEXT NOT NULL,
          id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0), doc TEXT NOT NULL,
          PRIMARY KEY (tenant, workspace, type, id),
          FOREIGN KEY (tenant,workspace) REFERENCES scope_registry(tenant,workspace)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS business_events (
          seq INTEGER PRIMARY KEY, tenant TEXT NOT NULL, workspace TEXT NOT NULL,
          event_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, hash TEXT NOT NULL,
          prev_hash TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY (tenant,workspace) REFERENCES scope_registry(tenant,workspace)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS events_scope ON business_events(tenant, workspace, seq);
        CREATE TABLE IF NOT EXISTS idempotency (
          tenant TEXT NOT NULL, workspace TEXT NOT NULL, key TEXT NOT NULL,
          request_hash TEXT NOT NULL, result TEXT NOT NULL, event_id TEXT NOT NULL,
          PRIMARY KEY (tenant, workspace, key),
          FOREIGN KEY (event_id) REFERENCES business_events(event_id)
        ) STRICT;
        CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON business_events
          BEGIN SELECT RAISE(ABORT, 'business events are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON business_events
          BEGIN SELECT RAISE(ABORT, 'business events are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS idempotency_no_update BEFORE UPDATE ON idempotency
          BEGIN SELECT RAISE(ABORT, 'idempotency receipts are append-only'); END;
        CREATE TRIGGER IF NOT EXISTS idempotency_no_delete BEFORE DELETE ON idempotency
          BEGIN SELECT RAISE(ABORT, 'idempotency receipts are append-only'); END;
      `);
      this.db.prepare('INSERT OR IGNORE INTO scope_registry VALUES (?,?,?)').run(tenantId, workspaceId, dataMode);
      const scope = this.db.prepare('SELECT data_mode FROM scope_registry WHERE tenant=? AND workspace=?').get(tenantId, workspaceId);
      assert(scope.data_mode === dataMode, 'DATA_MODE_MISMATCH', 'Existing workspace dataMode differs; use a separate workspace for live data', 409);
      const verification = this.verify();
      assert(verification.ok, 'LEDGER_INTEGRITY_FAILURE', 'Ledger or projection is corrupt; writes are blocked', 409, verification);
    } catch (error) {
      if (this.db?.isOpen) this.db.close();
      if (error instanceof BusinessError) throw error;
      throw new BusinessError('DATABASE_OPEN_FAILED', 'Unable to open the local business database', 500, { cause: error.code ?? error.name });
    }
  }

  close() { if (this.db?.isOpen) this.db.close(); }
  get(type, id, required = true) {
    const row = this.db.prepare('SELECT doc FROM entities WHERE tenant=? AND workspace=? AND type=? AND id=?').get(this.tenantId, this.workspaceId, type, id);
    if (!row) { assert(!required, 'NOT_FOUND', `${type} ${id} does not exist in the current workspace`, 404); return null; }
    return JSON.parse(row.doc);
  }
  list(type, { limit = 500, offset = 0 } = {}) {
    return this.db.prepare('SELECT doc FROM entities WHERE tenant=? AND workspace=? AND type=? ORDER BY id LIMIT ? OFFSET ?').all(this.tenantId, this.workspaceId, type, limit, offset).map(row => JSON.parse(row.doc));
  }
  count(type) { return this.db.prepare('SELECT COUNT(*) AS count FROM entities WHERE tenant=? AND workspace=? AND type=?').get(this.tenantId, this.workspaceId, type).count; }
  all(type) { return this.db.prepare('SELECT doc FROM entities WHERE tenant=? AND workspace=? AND type=? ORDER BY id').all(this.tenantId, this.workspaceId, type).map(row => JSON.parse(row.doc)); }
  save(type, id, fields, { create = false, expectedVersion } = {}) {
    assert(this.changes, 'TRANSACTION_REQUIRED', 'Entity writes require a business transaction', 500);
    const previous = this.get(type, id, false);
    if (create) assert(!previous, 'ALREADY_EXISTS', `${type} ${id} already exists`, 409);
    if (expectedVersion !== undefined) assert(previous?.version === expectedVersion, 'VERSION_CONFLICT', 'Entity changed since it was read', 409, { type, id, expectedVersion, actualVersion: previous?.version ?? 0 });
    const next = { ...clone(fields), id, type, tenantId: this.tenantId, workspaceId: this.workspaceId, dataMode: this.dataMode, version: (previous?.version ?? 0) + 1, createdAt: previous?.createdAt ?? this.now(), updatedAt: this.now() };
    this.db.prepare('INSERT INTO entities VALUES (?,?,?,?,?,?) ON CONFLICT(tenant,workspace,type,id) DO UPDATE SET version=excluded.version,doc=excluded.doc').run(this.tenantId, this.workspaceId, type, id, next.version, canonical(next));
    const key = `${type}:${id}`;
    if (!this.changes.has(key)) this.changes.set(key, { type, id, before: previous ? { version: previous.version, digest: digest(previous) } : null });
    this.changes.get(key).after = { version: next.version, digest: digest(next) };
    return next;
  }
  mutate(type, id, fields) { return this.save(type, id, { ...this.get(type, id), ...fields }); }
  recordFences(ids, result) {
    assert(this.fences, 'TRANSACTION_REQUIRED', 'Fence evidence requires a business transaction', 500);
    for (const id of ids) this.fences.set(id, result);
  }

  transaction(operation, input, actor, handler, risk = 'auto', fenceIds = []) {
    try {
      this.db.exec('BEGIN IMMEDIATE');
      const verification = this.verify();
      assert(verification.ok, 'LEDGER_INTEGRITY_FAILURE', 'Ledger or projection is corrupt; writes are blocked', 409, verification);
      const { idempotencyKey, ...payload } = input;
      const requestHash = digest({ operation, input: payload, actor: { id: actor.id, role: actor.role, channel: actor.channel } });
      const existing = this.db.prepare('SELECT request_hash,result FROM idempotency WHERE tenant=? AND workspace=? AND key=?').get(this.tenantId, this.workspaceId, idempotencyKey);
      if (existing) {
        assert(existing.request_hash === requestHash, 'IDEMPOTENCY_CONFLICT', 'This idempotencyKey was already used for a different request or actor', 409);
        this.db.exec('COMMIT');
        return { ...JSON.parse(existing.result), replayed: true };
      }
      this.changes = new Map();
      this.fences = new Map();
      this.recordFences(fenceIds, risk === 'review' ? 'review' : 'pass');
      const data = handler();
      assert(data !== undefined, 'MISSING_RESULT', 'Operation did not produce a verifiable result', 500);
      const seq = this.db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM business_events').get().seq;
      const eventId = `E-${seq}`;
      const previous = this.db.prepare('SELECT hash FROM business_events WHERE tenant=? AND workspace=? ORDER BY seq DESC LIMIT 1').get(this.tenantId, this.workspaceId);
      const prevHash = previous?.hash ?? '0'.repeat(64);
      const changes = [...this.changes.values()];
      const object = changes.length ? { type: changes[0].type, id: changes[0].id } : { type: 'runtime', id: this.workspaceId };
      const receipt = { id: `R-${randomUUID()}`, eventId, operation, kind: 'local.sqlite.commit', mode: this.dataMode, dataMode: this.dataMode, localCommitted: true, externalVerified: false, synced: false, createdAt: this.now(), resultDigest: digest(data), changes: changes.length };
      const event = {
        event_id: eventId,
        who: { type: actor.humanConfirmed ? 'human' : 'agent', id: actor.id, version: 'smart-home-runtime/1.0.0' },
        context: { tenant_id: this.tenantId, workspace_id: this.workspaceId, time: this.now(), channel: actor.channel, data_mode: this.dataMode, industry: 'smart-home' },
        object,
        decision: { action: operation, before: changes.map(item => ({ type: item.type, id: item.id, ...item.before })), after: changes.map(item => ({ type: item.type, id: item.id, ...item.after })), result_digest: receipt.resultDigest, idempotency_key: idempotencyKey, request_digest: requestHash },
        rule_impact: [...this.fences].map(([ruleId, result]) => ({ rule_id: ruleId, version: 'smart-home-baseline/v1', result })),
        receipt,
        prev_hash: prevHash,
      };
      const hash = digest(event);
      this.db.prepare('INSERT INTO business_events VALUES (?,?,?,?,?,?,?,?)').run(seq, this.tenantId, this.workspaceId, eventId, canonical(event), hash, prevHash, this.now());
      const result = { operation, data, receipt: { ...receipt, eventHash: hash }, replayed: false };
      this.db.prepare('INSERT INTO idempotency VALUES (?,?,?,?,?,?)').run(this.tenantId, this.workspaceId, idempotencyKey, requestHash, canonical(result), eventId);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      if (error instanceof BusinessError) throw error;
      const busy = error.code === 'ERR_SQLITE_ERROR' && /locked|busy/i.test(error.message);
      throw new BusinessError(busy ? 'DATABASE_BUSY' : 'DATABASE_WRITE_FAILED', busy ? 'Local database is busy; retry with the same idempotencyKey' : 'Local transaction failed and was rolled back', busy ? 503 : 500, { cause: error.code ?? error.name });
    } finally { this.changes = null; this.fences = null; }
  }

  events({ limit = 100, after = 0 } = {}) {
    return this.db.prepare('SELECT seq,payload,hash FROM business_events WHERE tenant=? AND workspace=? AND seq>? ORDER BY seq LIMIT ?').all(this.tenantId, this.workspaceId, after, limit).map(row => ({ ...JSON.parse(row.payload), hash: row.hash, seq: row.seq }));
  }
  verify() {
    const rows = this.db.prepare('SELECT seq,event_id,payload,hash,prev_hash FROM business_events WHERE tenant=? AND workspace=? ORDER BY seq').all(this.tenantId, this.workspaceId);
    let previous = '0'.repeat(64);
    const anchors = new Map();
    const eventMap = new Map();
    const issues = [];
    for (const row of rows) {
      try {
        const event = JSON.parse(row.payload);
        if (row.prev_hash !== previous || event.prev_hash !== previous || digest(event) !== row.hash || event.event_id !== row.event_id || row.event_id !== `E-${row.seq}` || event.context.tenant_id !== this.tenantId || event.context.workspace_id !== this.workspaceId || event.context.data_mode !== this.dataMode) issues.push({ eventId: row.event_id, code: 'EVENT_HASH_MISMATCH' });
        for (const effect of event.decision.after) anchors.set(`${effect.type}:${effect.id}`, effect);
        eventMap.set(row.event_id, { event, hash: row.hash });
        previous = row.hash;
      } catch { issues.push({ eventId: row.event_id, code: 'INVALID_EVENT_PAYLOAD' }); }
    }
    const entities = this.db.prepare('SELECT type,id,version,doc FROM entities WHERE tenant=? AND workspace=?').all(this.tenantId, this.workspaceId);
    const entityKeys = new Set();
    for (const row of entities) {
      const key = `${row.type}:${row.id}`;
      entityKeys.add(key);
      const anchor = anchors.get(key);
      try {
        const doc = JSON.parse(row.doc);
        if (!anchor || anchor.version !== row.version || doc.version !== row.version || anchor.digest !== digest(doc) || doc.tenantId !== this.tenantId || doc.workspaceId !== this.workspaceId || doc.dataMode !== this.dataMode) issues.push({ type: row.type, id: row.id, code: 'PROJECTION_DIGEST_MISMATCH' });
      } catch { issues.push({ type: row.type, id: row.id, code: 'INVALID_ENTITY_PAYLOAD' }); }
    }
    for (const key of anchors.keys()) if (!entityKeys.has(key)) issues.push({ key, code: 'PROJECTION_MISSING' });
    const idempotency = this.db.prepare('SELECT key,request_hash,result,event_id FROM idempotency WHERE tenant=? AND workspace=?').all(this.tenantId, this.workspaceId);
    const receiptEvents = new Set();
    for (const row of idempotency) {
      try {
        const result = JSON.parse(row.result), anchor = eventMap.get(row.event_id);
        if (!anchor || anchor.event.decision.idempotency_key !== row.key || anchor.event.decision.request_digest !== row.request_hash || result.operation !== anchor.event.decision.action || digest(result.data) !== anchor.event.receipt.resultDigest || result.receipt.eventHash !== anchor.hash || result.receipt.eventId !== row.event_id || digest(Object.fromEntries(Object.entries(result.receipt).filter(([key]) => key !== 'eventHash'))) !== digest(anchor.event.receipt)) issues.push({ key: row.key, code: 'IDEMPOTENCY_RECEIPT_MISMATCH' });
        receiptEvents.add(row.event_id);
      } catch { issues.push({ key: row.key, code: 'INVALID_IDEMPOTENCY_RECEIPT' }); }
    }
    for (const row of rows) if (!receiptEvents.has(row.event_id)) issues.push({ eventId: row.event_id, code: 'IDEMPOTENCY_RECEIPT_MISSING' });
    return { ok: issues.length === 0, checkedEvents: rows.length, checkedEntities: entities.length, checkedReceipts: idempotency.length, headHash: previous, issues };
  }
}
