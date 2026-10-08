import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import YAML from "yaml";
import { SMART_HOME_SEED, seedSmartHomeWorkspace } from "./seed-smart-home";

const supplied = process.env.BMS_PG_TEST_URL;
const enabled = Boolean(supplied);
const root = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "bundles/smart-home/bundle.json"), "utf8"));
const firstSkillPath = manifest.workloom.provides.skills[0] as string;
const skillBody = readFileSync(join(root, "bundles/smart-home", firstSkillPath), "utf8");
const firstSkill = YAML.parse(/^---\n([\s\S]*?)\n---/.exec(skillBody)![1]!) as { name: string };
const skillId = `skill-smart-home-${firstSkill.name}`;

describe.skipIf(!enabled)("smart-home seed real PostgreSQL safety", () => {
  const database = `bms_seed_test_${randomUUID().replaceAll("-", "")}`;
  let admin: pg.Client;
  let client: pg.Client;
  let url: string;
  let created = false;
  beforeAll(async () => {
    const connection = new URL(supplied!);
    if (connection.protocol !== "postgres:" && connection.protocol !== "postgresql:") throw new Error("PostgreSQL test URL required");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(connection.hostname)) throw new Error("Seeder tests require a local disposable database");
    admin = new pg.Client({ connectionString: supplied, connectionTimeoutMillis: 5000 });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`); created = true;
    connection.pathname = `/${database}`; url = connection.href;
    client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
    await client.connect();
    for (const file of readdirSync(join(root, "packages/db/migrations")).filter(file => file.endsWith(".sql")).sort()) await client.query(readFileSync(join(root, "packages/db/migrations", file), "utf8"));
  }, 30000);
  afterAll(async () => {
    try { if (client) await client.end(); }
    finally {
      if (admin) {
        try { if (created) await admin.query(`DROP DATABASE "${database}"`); }
        finally { await admin.end(); }
      }
    }
  }, 10000);

  test("unrelated preexisting tenant cannot receive the sandbox", async () => {
    await client.query("INSERT INTO tenants(id,name) VALUES($1,'unrelated test tenant')", [SMART_HOME_SEED.tenantId]);
    try {
      await expect(seedSmartHomeWorkspace(url)).rejects.toThrow("installation provenance");
      expect((await client.query("SELECT count(*)::int n FROM workspaces")).rows[0].n).toBe(0);
    } finally { await client.query("DELETE FROM tenants WHERE id=$1", [SMART_HOME_SEED.tenantId]); }
  });

  test("static skill collision rolls the complete seed transaction back", async () => {
    await client.query("INSERT INTO skills(id,level,bundle,name,body) VALUES($1,'industry','unrelated','collision','collision')", [skillId]);
    try {
      await expect(seedSmartHomeWorkspace(url)).rejects.toThrow("content or ownership differs: skills");
      expect((await client.query("SELECT count(*)::int n FROM workspaces")).rows[0].n).toBe(0);
      expect((await client.query("SELECT count(*)::int n FROM tenants")).rows[0].n).toBe(0);
      expect((await client.query("SELECT body FROM skills WHERE id=$1", [skillId])).rows[0].body).toBe("collision");
    } finally { await client.query("DELETE FROM skills WHERE id=$1", [skillId]); }
  });

  test("first seed, repeat and concurrent repeat have exact assets and no business events", async () => {
    const first = await seedSmartHomeWorkspace(url);
    expect(first).toMatchObject({ agents: 20, skills: 35, fences: 16, installs: 1, chunks: 32, businessEventsCreated: 0, modelCalls: 0 });
    expect(await seedSmartHomeWorkspace(url)).toEqual(first);
    const repeats = await Promise.all([seedSmartHomeWorkspace(url), seedSmartHomeWorkspace(url)]);
    expect(repeats).toEqual([first, first]);
    expect((await client.query("SELECT count(*)::int n FROM biz_events")).rows[0].n).toBe(0);
  });

  test("production mode is rejected before writes", async () => {
    const prior = process.env.NODE_ENV; process.env.NODE_ENV = "production";
    try { await expect(seedSmartHomeWorkspace(url)).rejects.toThrow("Production"); }
    finally { if (prior === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prior; }
  });

  test("real workspace is preserved", async () => {
    await client.query("UPDATE workspaces SET is_example=false WHERE id=$1", [SMART_HOME_SEED.workspaceId]);
    try { await expect(seedSmartHomeWorkspace(url)).rejects.toThrow("not this sandbox"); }
    finally { await client.query("UPDATE workspaces SET is_example=true WHERE id=$1", [SMART_HOME_SEED.workspaceId]); }
  });

  test("different active bundle and manifest digest require governed reassembly", async () => {
    const install = (await client.query("SELECT id,assets FROM bundle_installs WHERE workspace_id=$1", [SMART_HOME_SEED.workspaceId])).rows[0];
    await client.query("UPDATE bundle_installs SET assets=jsonb_set(assets,'{manifest_digest}',to_jsonb('changed'::text)) WHERE id=$1", [install.id]);
    try { await expect(seedSmartHomeWorkspace(url)).rejects.toThrow("Existing active bundle differs"); }
    finally { await client.query("UPDATE bundle_installs SET assets=$2 WHERE id=$1", [install.id, JSON.stringify(install.assets)]); }
    await client.query("UPDATE bundle_installs SET bundle_id='hotel' WHERE id=$1", [install.id]);
    try { await expect(seedSmartHomeWorkspace(url)).rejects.toThrow("Existing active bundle differs"); }
    finally { await client.query("UPDATE bundle_installs SET bundle_id='smart-home' WHERE id=$1", [install.id]); }
  });

  test("globally revoked skill cannot be reinstalled by the example seeder", async () => {
    await client.query("INSERT INTO skill_revocations(skill_id,reason,revoked_by) VALUES($1,'test-only revoke','test-owner')", [skillId]);
    try { await expect(seedSmartHomeWorkspace(url)).rejects.toThrow("globally revoked"); }
    finally { await client.query("DELETE FROM skill_revocations WHERE skill_id=$1", [skillId]); }
  });

  const cases = [
    { table: "members", field: "role", value: "readonly", where: "workspace_id=$1 AND member_no='MEM-001'" },
    { table: "agents", field: "name", value: "changed test role", where: "workspace_id=$1 AND preset_key='store-ceo'" },
    { table: "fence_rules", field: "name", value: "changed test fence", where: "workspace_id=$1 AND rule_id='R-SH1'" },
    { table: "skills", field: "body", value: "changed test skill", where: "bundle='smart-home' AND id=$1", parameter: skillId },
    { table: "skill_installs", field: "installed_by", value: "changed-test-member", where: "workspace_id=$1 AND skill_id='" + skillId + "'" },
    { table: "profiles", field: "pii_vault", value: { test: "must remain untouched" }, where: "workspace_id=$1", json: true },
    { table: "kb_collections", field: "name", value: "changed test collection", where: "workspace_id=$1", first: true },
    { table: "kb_documents", field: "hash", value: "changed test hash", where: "workspace_id=$1", first: true },
    { table: "kb_chunks", field: "content", value: "changed test chunk", where: "workspace_id=$1", first: true },
  ];
  for (const item of cases) test(`tampered ${item.table}.${item.field} is detected and preserved`, async () => {
    const parameter = item.parameter ?? SMART_HOME_SEED.workspaceId;
    const key = item.table === "profiles" || item.table === "skill_installs" ? undefined : "id";
    const rows = (await client.query(`SELECT * FROM ${item.table} WHERE ${item.where}`, [parameter])).rows;
    const row = rows[0]; expect(row).toBeTruthy();
    const where = key ? `${key}=$1` : item.where;
    const identity = key ? row.id : parameter;
    const encode = (value: unknown) => item.json && value !== null ? JSON.stringify(value) : value;
    await client.query(`UPDATE ${item.table} SET ${item.field}=$2 WHERE ${where}`, [identity, encode(item.value)]);
    try {
      await expect(seedSmartHomeWorkspace(url)).rejects.toThrow(`content or ownership differs: ${item.table}`);
      expect((await client.query(`SELECT ${item.field} FROM ${item.table} WHERE ${where}`, [identity])).rows[0][item.field]).toEqual(item.value);
    } finally { await client.query(`UPDATE ${item.table} SET ${item.field}=$2 WHERE ${where}`, [identity, encode(row[item.field])]); }
  });

  test("missing connection and unavailable database fail explicitly", async () => {
    await expect(seedSmartHomeWorkspace("")).rejects.toThrow("DATABASE_URL");
    const absent = new URL(url); absent.pathname = "/bms_seed_nonexistent_test";
    await expect(seedSmartHomeWorkspace(absent.href)).rejects.toThrow("does not exist");
  });
});
