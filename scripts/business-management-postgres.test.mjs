import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const connectionString = process.env.BMS_PG_TEST_URL;
test('PostgreSQL governance channels reject baseline moves and global revocation by application roles', { skip: !connectionString }, async t => {
  const url = new URL(connectionString);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Use an isolated loopback test database');
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  const suffix = crypto.randomUUID();
  const globalId = `bms-test-global-${suffix}`, localId = `bms-test-local-${suffix}`, skillId = `bms-test-skill-${suffix}`;
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("INSERT INTO fence_rules(id,rule_id,version,workspace_id,name,level,match_spec,action,is_baseline,status,created_by) VALUES($1,$1,'test','*','test global','block','{}','{}',true,'active','test'),($2,$2,'test','bms-security-test','test local','review','{}','{}',false,'active','test')", [globalId, localId]);
    await client.query("INSERT INTO skills(id,level,name) VALUES($1,'industry','transaction-only test')", [skillId]);
    for (const role of ['workloom_app', 'workloom_gateway']) {
      await client.query(`SET LOCAL ROLE ${role}`);
      await client.query("SELECT set_config('app.workspace_id','bms-security-test',true),set_config('app.tenant_id','bms-security-tenant',true)");
      const denied = async (name, sql, params) => {
        await t.test(`${role}: ${name}`, async () => {
          await client.query('SAVEPOINT expected_denial');
          let error;
          try { await client.query(sql, params); } catch (caught) { error = caught; }
          await client.query('ROLLBACK TO SAVEPOINT expected_denial');
          assert.equal(error?.code, '42501', `Expected permission denial, received ${error?.code ?? 'success'}`);
        });
      };
      await denied('cannot move a global baseline and lower its level', "UPDATE fence_rules SET workspace_id='bms-security-test',level='auto' WHERE id=$1", [globalId]);
      await denied('cannot update a global baseline in place', "UPDATE fence_rules SET level='auto' WHERE id=$1", [globalId]);
      await denied('cannot delete a global baseline', 'DELETE FROM fence_rules WHERE id=$1', [globalId]);
      await denied('cannot promote a local rule to a global baseline', "UPDATE fence_rules SET workspace_id='*' WHERE id=$1", [localId]);
      await denied('cannot call global skill revocation with a forged owner', 'SELECT public.skill_revoke($1,$2,$3)', [skillId, 'test', 'forged-owner']);
      await denied('cannot directly insert a global revocation', 'INSERT INTO skill_revocations(skill_id,reason,revoked_by) VALUES($1,$2,$3)', [skillId, 'test', 'forged-owner']);
      await t.test(`${role}: scoped local rule updates still work`, async () => {
        const result = await client.query("UPDATE fence_rules SET name='local update' WHERE id=$1", [localId]);
        assert.equal(result.rowCount, 1);
      });
      await client.query('RESET ROLE');
    }
    await t.test('administrative owner revocation remains idempotent', async () => {
      assert.equal((await client.query('SELECT public.skill_revoke($1,$2,$3) AS changed', [skillId, 'test admin', 'administrative-owner'])).rows[0].changed, true);
      assert.equal((await client.query('SELECT public.skill_revoke($1,$2,$3) AS changed', [skillId, 'test duplicate', 'administrative-owner'])).rows[0].changed, false);
      const row = (await client.query('SELECT revoked_by FROM skill_revocations WHERE skill_id=$1', [skillId])).rows[0];
      assert.equal(row.revoked_by, 'administrative-owner');
    });
    await client.query('ROLLBACK');
    assert.equal((await client.query('SELECT count(*)::int AS remaining FROM fence_rules WHERE id=ANY($1)', [[globalId, localId]])).rows[0].remaining, 0);
    assert.equal((await client.query('SELECT count(*)::int AS remaining FROM skill_revocations WHERE skill_id=$1', [skillId])).rows[0].remaining, 0);
  } finally {
    try { await client.query('ROLLBACK'); } catch (error) { console.error('Sandbox rollback failed:', error.code ?? 'UNKNOWN'); }
    await client.end();
  }
});
