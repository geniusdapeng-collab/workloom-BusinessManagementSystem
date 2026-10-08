/** Default foundation workspace: explicit sandbox assets, no invented delivery events. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import YAML from "yaml";
import { loadVerifiedBundleManifest, loadVerifiedBundleWorkforcePresets } from "@workloom/base/bundles";

const ROOT = resolve(import.meta.dirname, "..");
const BUNDLE = "smart-home";
const TENANT = "tenant-smart-home-demo";
export const SMART_HOME_SEED = Object.freeze({ workspaceId: "ws-smart-home", slug: "smart-home-demo", tenantId: TENANT, bundleId: BUNDLE, isExample: true });
type Rule = { rule_id: string; name: string; level: "auto" | "review" | "block"; is_baseline: boolean; match: Record<string, unknown>; when: unknown; note?: string };
type Faq = { categories: Array<{ key: string; name: string; docTitle: string; items: Array<{ q: string; a: string }> }> };
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export async function seedSmartHomeWorkspace(connectionString: string, bundleRoot = join(ROOT, "bundles")): Promise<Record<string, unknown>> {
  if (process.env.NODE_ENV === "production") throw new Error("Production cannot run the sandbox example seeder");
  if (!connectionString) throw new Error("DATABASE_URL is required for foundation seeding");
  const manifest = loadVerifiedBundleManifest(BUNDLE, bundleRoot);
  const presets = loadVerifiedBundleWorkforcePresets(BUNDLE, bundleRoot);
  const bundleDir = join(bundleRoot, BUNDLE);
  const fenceDocument = YAML.parse(readFileSync(join(bundleDir, manifest.workloom.fenceRef), "utf8")) as { version: string; rules: Rule[] };
  if (!fenceDocument.version || !Array.isArray(fenceDocument.rules) || fenceDocument.rules.length === 0) throw new Error("Baseline fence asset is invalid");
  const ruleIds = new Set(fenceDocument.rules.map(rule => rule.rule_id));
  if (ruleIds.size !== fenceDocument.rules.length) throw new Error("Baseline fence identifiers are duplicated");
  const skills = manifest.workloom.provides.skills.map(asset => {
    const body = readFileSync(join(bundleDir, asset), "utf8");
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body);
    if (!front) throw new Error(`Skill metadata is absent: ${asset}`);
    const metadata = YAML.parse(front[1]!) as { name?: string; description?: string; version?: string; fence_bindings?: string[] };
    if (typeof metadata.name !== "string" || typeof metadata.description !== "string" || !metadata.description.trim()) throw new Error(`Skill metadata is invalid: ${asset}`);
    const fenceBindings = metadata.fence_bindings ?? [];
    if (!Array.isArray(fenceBindings) || fenceBindings.some(binding => !ruleIds.has(binding))) throw new Error(`Skill fence reference is invalid: ${asset}`);
    return { name: metadata.name, description: metadata.description, version: metadata.version ?? "1.0.0", fenceBindings, body };
  });
  const skillNames = new Set(skills.map(skill => skill.name));
  if (skillNames.size !== skills.length) throw new Error("Skill identifiers are duplicated");
  for (const preset of presets) {
    if (preset.fence_bindings.some(binding => !ruleIds.has(binding))) throw new Error(`Unknown preset fence: ${preset.preset_key}`);
    if (preset.skills.some(skill => !skillNames.has(skill))) throw new Error(`Unknown preset skill: ${preset.preset_key}`);
  }
  const faqPath = manifest.workloom.provides.serviceFront.find(asset => asset.endsWith("/faq.json"));
  if (!faqPath) throw new Error("FAQ asset is not declared");
  const faq = JSON.parse(readFileSync(join(bundleDir, faqPath), "utf8")) as Faq;
  if (!Array.isArray(faq.categories) || faq.categories.some(category => !category.key || !category.name || !Array.isArray(category.items) || category.items.some(item => !item.q || !item.a))) throw new Error("FAQ structure is invalid");
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
  const workspace = SMART_HOME_SEED.workspaceId;
  const expectedRows: Array<{ table: string; identity: Record<string, unknown>; row: Record<string, unknown> }> = [];
  const expect = (table: string, identity: Record<string, unknown>, row: Record<string, unknown>) => expectedRows.push({ table, identity, row });
  let begun = false;
  try {
    await client.connect();
    await client.query("BEGIN"); begun = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`smart-home-seed:${workspace}`]);
    const existing = await client.query<{ industry: string; is_example: boolean; bundle_id: string; tenant_id: string; slug: string }>("SELECT industry,is_example,bundle_id,tenant_id,slug FROM workspaces WHERE id=$1 FOR UPDATE", [workspace]);
    const current = existing.rows[0];
    if (current && (!current.is_example || current.industry !== BUNDLE || current.bundle_id !== BUNDLE || current.tenant_id !== TENANT || current.slug !== SMART_HOME_SEED.slug)) throw new Error("Existing workspace is not this sandbox example; refusing to overwrite it");
    const active = await client.query<{ bundle_id: string; assets: { manifest_digest?: string } }>("SELECT bundle_id,assets FROM bundle_installs WHERE workspace_id=$1 AND status='active' FOR UPDATE", [workspace]);
    if (active.rows.some(row => row.bundle_id !== BUNDLE || row.assets.manifest_digest !== manifest.integrity?.digest)) throw new Error("Existing active bundle differs; use governed reassembly instead of seeding");
    const tenant = await client.query("SELECT id FROM tenants WHERE id=$1 FOR UPDATE", [TENANT]);
    if (tenant.rowCount && (!current || active.rowCount !== 1)) throw new Error("Existing tenant lacks this sandbox installation provenance; refusing to attach an example");
    await client.query("LOCK TABLE skill_revocations IN SHARE MODE");
    const revoked = await client.query("SELECT skill_id FROM skill_revocations WHERE skill_id=ANY($1::text[])", [skills.map(skill => `skill-smart-home-${skill.name}`)]);
    if (revoked.rowCount) throw new Error("A seeded skill is globally revoked; refusing to install it");
    await client.query("INSERT INTO tenants(id,name,plan) VALUES($1,$2,'pro') ON CONFLICT(id) DO NOTHING", [TENANT, "全屋智能沙箱租户"]);
    expect("tenants", { id: TENANT }, { id: TENANT, name: "全屋智能沙箱租户", plan: "pro", status: "active" });
    await client.query("INSERT INTO workspaces(id,tenant_id,name,slug,industry,stage,night_config,bundle_id,is_example) VALUES($1,$2,$3,$4,$5,'store-onboarding',$6,$5,true) ON CONFLICT(id) DO NOTHING", [workspace, TENANT, "全屋智能经营演练门店", SMART_HOME_SEED.slug, BUNDLE, JSON.stringify({ enabled: false, timezone: "Asia/Shanghai", reason: "Host workbench must explicitly schedule model tasks" })]);
    expect("workspaces", { id: workspace }, { id: workspace, tenant_id: TENANT, name: "全屋智能经营演练门店", slug: SMART_HOME_SEED.slug, industry: BUNDLE, stage: "store-onboarding", night_config: { enabled: false, timezone: "Asia/Shanghai", reason: "Host workbench must explicitly schedule model tasks" }, bundle_id: BUNDLE, is_example: true });
    const members = [{ no: "MEM-001", name: "董事长", role: "owner" }, { no: "MEM-002", name: "门店运营负责人", role: "manager" }, { no: "MEM-003", name: "现场技术人员", role: "readonly" }];
    for (const member of members) {
      const id = `member-${workspace}-${member.no}`;
      await client.query("INSERT INTO members(id,workspace_id,member_no,name,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,member_no) DO NOTHING", [id, workspace, member.no, member.name, member.role]);
      expect("members", { workspace_id: workspace, member_no: member.no }, { id, workspace_id: workspace, member_no: member.no, name: member.name, role: member.role });
    }
    const presetIds: string[] = [];
    for (const preset of presets) {
      const id = `agent-${workspace}-${preset.preset_key}`; presetIds.push(id);
      await client.query("INSERT INTO agents(id,workspace_id,preset_key,name,version,kind,readonly,fence_bindings,skills,status,meta) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready',$10) ON CONFLICT(id) DO NOTHING", [id, workspace, preset.preset_key, preset.name, preset.version, preset.kind, preset.readonly, JSON.stringify(preset.fence_bindings), JSON.stringify(preset.skills), JSON.stringify({ description: preset.description, night_shift: preset.night_shift, high_risk: preset.high_risk, tools: preset.tools, prompt: preset.prompt, write_back: preset.write_back, coverage: preset.coverage, dataMode: "sandbox", modelProvider: "host-workbench" })]);
      expect("agents", { id }, { id, workspace_id: workspace, preset_key: preset.preset_key, name: preset.name, version: preset.version, kind: preset.kind, readonly: preset.readonly, fence_bindings: preset.fence_bindings, skills: preset.skills, status: "ready", meta: { description: preset.description, night_shift: preset.night_shift, high_risk: preset.high_risk, tools: preset.tools, prompt: preset.prompt, write_back: preset.write_back, coverage: preset.coverage, dataMode: "sandbox", modelProvider: "host-workbench" } });
    }
    const fenceIds: string[] = [];
    for (const rule of fenceDocument.rules) {
      if (!["auto", "review", "block"].includes(rule.level)) throw new Error(`Invalid fence level: ${rule.rule_id}`);
      const id = `fence-${workspace}-${rule.rule_id}-${fenceDocument.version.replaceAll("/", "-")}`; fenceIds.push(id);
      await client.query("INSERT INTO fence_rules(id,rule_id,version,workspace_id,name,level,match_spec,action,is_baseline,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active','system:smart-home-example') ON CONFLICT(rule_id,version,workspace_id) DO NOTHING", [id, rule.rule_id, fenceDocument.version, workspace, rule.name, rule.level, JSON.stringify({ ...rule.match, when: rule.when }), JSON.stringify({ result: rule.level === "auto" ? "pass" : rule.level === "review" ? "review" : "blocked", note: rule.note ?? "" }), rule.is_baseline]);
      expect("fence_rules", { rule_id: rule.rule_id, version: fenceDocument.version, workspace_id: workspace }, { id, rule_id: rule.rule_id, version: fenceDocument.version, workspace_id: workspace, name: rule.name, level: rule.level, match_spec: { ...rule.match, when: rule.when }, action: { result: rule.level === "auto" ? "pass" : rule.level === "review" ? "review" : "blocked", note: rule.note ?? "" }, is_baseline: rule.is_baseline, status: "active" });
    }
    const skillIds: string[] = [];
    for (const skill of skills) {
      const id = `skill-smart-home-${skill.name}`; skillIds.push(id);
      await client.query("INSERT INTO skills(id,level,bundle,name,version,description,fence_bindings,body,desensitized) VALUES($1,'industry',$2,$3,$4,$5,$6,$7,true) ON CONFLICT(id) DO NOTHING", [id, BUNDLE, skill.name, skill.version, skill.description, JSON.stringify(skill.fenceBindings), skill.body]);
      expect("skills", { id }, { id, level: "industry", bundle: BUNDLE, name: skill.name, version: skill.version, description: skill.description, fence_bindings: skill.fenceBindings, body: skill.body, desensitized: true });
      await client.query("INSERT INTO skill_installs(skill_id,workspace_id,installed_by,installed_version,fence_bindings_snapshot) VALUES($1,$2,$3,$4,$5) ON CONFLICT(skill_id,workspace_id) DO NOTHING", [id, workspace, `member-${workspace}-MEM-001`, skill.version, JSON.stringify(skill.fenceBindings)]);
      expect("skill_installs", { skill_id: id, workspace_id: workspace }, { skill_id: id, workspace_id: workspace, installed_by: `member-${workspace}-MEM-001`, installed_version: skill.version, fence_bindings_snapshot: skill.fenceBindings });
    }
    const forbidden = ["未经用途授权不得触达或导出客户资料", "型号或固件兼容依据缺失不得承诺方案", "报价毛利与折扣不得越过门店硬底线", "现场勘测、安装、调试和验收不得由模型冒称完成", "外部发布、支付和危险设备控制未启用"];
    const archive = { property: { name: "全屋智能经营演练门店", city: "沙箱城市", serviceAreas: ["沙箱区域"], segment: "new_build" }, business: { minMarginRatio: 0.25, maxDiscountRatio: 0.08, quoteValidityDays: 7 }, forbidden: forbidden.map(rule => ({ rule })), goals: { title: "使用宿主模型完成获客演练", dataMode: "sandbox" }, dataMode: "sandbox" };
    await client.query("INSERT INTO profiles(workspace_id,tenant_id,industry,archive,forbidden,pii_vault) VALUES($1,$2,$3,$4,$5,NULL) ON CONFLICT(workspace_id) DO NOTHING", [workspace, TENANT, BUNDLE, JSON.stringify(archive), JSON.stringify(forbidden)]);
    expect("profiles", { workspace_id: workspace }, { workspace_id: workspace, tenant_id: TENANT, industry: BUNDLE, archive, forbidden, pii_vault: null });
    const collections: string[] = [];
    let faqCount = 0;
    for (const category of faq.categories) {
      const collectionId = `kb-${workspace}-${category.key}`; collections.push(collectionId);
      const documentId = `doc-${workspace}-${category.key}`;
      const markdown = category.items.map(item => `## ${item.q}\n\n${item.a}`).join("\n\n");
      const hash = createHash("sha256").update(markdown).digest("hex");
      await client.query("INSERT INTO kb_collections(id,workspace_id,name,description) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", [collectionId, workspace, category.name, "全屋智能公开咨询知识，不含私人客户资料"]);
      expect("kb_collections", { id: collectionId }, { id: collectionId, workspace_id: workspace, name: category.name, description: "全屋智能公开咨询知识，不含私人客户资料", status: "active" });
      await client.query("INSERT INTO kb_documents(id,workspace_id,collection_id,title,source_kind,version,status,content_md,hash) VALUES($1,$2,$3,$4,'manual',1,'active',$5,$6) ON CONFLICT(id) DO NOTHING", [documentId, workspace, collectionId, category.docTitle, markdown, hash]);
      expect("kb_documents", { id: documentId }, { id: documentId, workspace_id: workspace, collection_id: collectionId, title: category.docTitle, source_kind: "manual", version: 1, status: "active", content_md: markdown, hash });
      for (const [index, item] of category.items.entries()) {
        await client.query("INSERT INTO kb_chunks(workspace_id,document_id,chunk_index,heading,content,keywords) VALUES($1,$2,$3,$4,$5,to_tsvector('simple',$5)) ON CONFLICT(document_id,chunk_index) DO NOTHING", [workspace, documentId, index, item.q, `${item.q}\n${item.a}`]); faqCount++;
        expect("kb_chunks", { document_id: documentId, chunk_index: index }, { workspace_id: workspace, document_id: documentId, chunk_index: index, heading: item.q, content: `${item.q}\n${item.a}` });
      }
    }
    await client.query("INSERT INTO bundle_installs(id,workspace_id,bundle_id,assets,status) VALUES($1,$2,$3,$4,'active') ON CONFLICT(id) DO NOTHING", [`install-${workspace}-${BUNDLE}`, workspace, BUNDLE, JSON.stringify({ preset_ids: presetIds, fence_rule_ids: fenceIds, skill_ids: skillIds, kb_collection_ids: collections, seed_batch_id: "smart-home-sandbox-v1", manifest_digest: manifest.integrity?.digest, manifest, data_mode: "sandbox" })]);
    expect("bundle_installs", { id: `install-${workspace}-${BUNDLE}` }, { id: `install-${workspace}-${BUNDLE}`, workspace_id: workspace, bundle_id: BUNDLE, assets: { preset_ids: presetIds, fence_rule_ids: fenceIds, skill_ids: skillIds, kb_collection_ids: collections, seed_batch_id: "smart-home-sandbox-v1", manifest_digest: manifest.integrity?.digest, manifest, data_mode: "sandbox" }, status: "active" });
    for (const expected of expectedRows) {
      const fields = Object.keys(expected.row);
      const keys = Object.keys(expected.identity);
      if (![expected.table, ...fields, ...keys].every(value => /^[a-z_]+$/.test(value))) throw new Error("Invalid static seed SQL identifier");
      const readback = await client.query(`SELECT ${fields.join(",")} FROM ${expected.table} WHERE ${keys.map((key, index) => `${key}=$${index + 1}`).join(" AND ")} FOR SHARE`, Object.values(expected.identity));
      if (readback.rowCount !== 1 || canonical(readback.rows[0]) !== canonical(expected.row)) throw new Error(`Seed content or ownership differs: ${expected.table}; refusing to overwrite`);
    }
    const counts = await client.query<{ agents: number; skills: number; installs: number; chunks: number }>("SELECT (SELECT count(*)::int FROM agents WHERE workspace_id=$1) agents,(SELECT count(*)::int FROM skill_installs WHERE workspace_id=$1) skills,(SELECT count(*)::int FROM bundle_installs WHERE workspace_id=$1 AND status='active') installs,(SELECT count(*)::int FROM kb_chunks WHERE workspace_id=$1) chunks", [workspace]);
    const checked = counts.rows[0]!;
    if (checked.agents !== presets.length || checked.skills !== skills.length || checked.installs !== 1 || checked.chunks !== faqCount) throw new Error("Seed read-back counts differ; transaction rolled back");
    await client.query("COMMIT"); begun = false;
    return { ...SMART_HOME_SEED, ...checked, fences: fenceIds.length, dataMode: "sandbox", businessEventsCreated: 0, modelCalls: 0, receipts: "postgres-transaction-readback", externalVerified: false };
  } catch (error) {
    if (begun) {
      try { await client.query("ROLLBACK"); } catch (rollbackError) { console.error("[smart-home-seed] Rollback failed", (rollbackError as NodeJS.ErrnoException).code ?? "UNKNOWN"); }
    }
    throw error;
  } finally { await client.end(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedSmartHomeWorkspace(process.env.DATABASE_URL ?? "")
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error("smart-home seed failed:", error instanceof Error ? error.message : "UNKNOWN"); process.exitCode = 1; });
}
