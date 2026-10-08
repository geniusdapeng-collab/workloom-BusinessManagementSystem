/** 合成服务契约夹具；事件账本保留，必须在可销毁测试数据库运行。 */
import type { Identity } from "@workloom/base/tenancy";
import type { MemberRole } from "@workloom/shared";

export const serviceContractPgUrl = process.env.BMS_PG_TEST_URL
  ?? (process.env.RUN_DB_TESTS === "1" ? process.env.DATABASE_URL : undefined);

export interface ServiceContractPgFixture {
  db: typeof import("@workloom/db");
  owner: ReturnType<typeof import("@workloom/db").getOwnerPool>;
  appRouter: typeof import("../trpc/router.js").appRouter;
  tenantId: string; workspaceId: string; foreignWorkspaceId: string;
  identity: (role?: MemberRole, foreign?: boolean) => Identity;
  caller: (role?: MemberRole, foreign?: boolean) => ReturnType<typeof import("../trpc/router.js").appRouter.createCaller>;
  scope: { tenantId: string; workspaceId: string };
  counts: (objectId?: string) => Promise<{ events: number; approvals: number; ticket_events: number }>;
  close: () => Promise<void>;
}

export async function createServiceContractPgFixture(label: string): Promise<ServiceContractPgFixture> {
  if (!serviceContractPgUrl) throw new Error("真实 PostgreSQL 服务契约缺少 BMS_PG_TEST_URL");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(serviceContractPgUrl).hostname)) {
    throw new Error("合成服务契约夹具只允许本机 PostgreSQL 测试数据库");
  }
  const environmentNames = ["DATABASE_URL", "DATABASE_APP_URL", "DATABASE_GATEWAY_URL", "LLM_PROVIDER", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"];
  const beforeEnvironment = new Map(environmentNames.map((name) => [name, process.env[name]]));
  const scopedRoleUrl = (role: string, password: string, current?: string) => {
    const target = new URL(serviceContractPgUrl);
    if (current) {
      const candidate = new URL(current);
      if (candidate.host === target.host && candidate.pathname === target.pathname && candidate.username === role) return candidate.href;
    }
    target.username = role; target.password = password;
    return target.href;
  };
  process.env.DATABASE_URL = serviceContractPgUrl;
  process.env.DATABASE_APP_URL = scopedRoleUrl("workloom_app", "workloom_dev_app", process.env.DATABASE_APP_URL);
  process.env.DATABASE_GATEWAY_URL = scopedRoleUrl("workloom_gateway", "workloom_dev_gateway", process.env.DATABASE_GATEWAY_URL);
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_API_KEY = ""; process.env.LLM_BASE_URL = ""; process.env.LLM_MODEL = "";
  const restoreEnvironment = () => {
    for (const [name, value] of beforeEnvironment) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  };
  let initializedDatabase: typeof import("@workloom/db") | undefined;
  try {
    const db = await import("@workloom/db");
    initializedDatabase = db;
    const { appRouter } = await import("../trpc/router.js");
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const tenantId = `tenant-${label}-${suffix}`;
    const workspaceId = `ws-${label}-${suffix}`;
    const foreignWorkspaceId = `${workspaceId}-foreign`;
    const owner = db.getOwnerPool();
    await owner.query("INSERT INTO tenants (id,name,plan) VALUES ($1,$2,'pro')", [tenantId, "合成服务契约租户"]);
    await owner.query("INSERT INTO workspaces (id,tenant_id,name,slug,industry,is_example) VALUES ($1,$3,$4,$1,'general',true),($2,$3,$4,$2,'general',true)",
      [workspaceId, foreignWorkspaceId, tenantId, "合成服务契约工作区"]);
    const identity = (role: MemberRole = "owner", foreign = false): Identity => {
      const workspace = foreign ? foreignWorkspaceId : workspaceId;
      return { kind: "member", memberId: `mem-${role}-${workspace}`, memberNo: `MEM-${role.toUpperCase()}`, name: "合成服务契约成员", role, plan: "pro", tenantId, workspaceId: workspace };
    };
    for (const workspace of [workspaceId, foreignWorkspaceId]) {
      for (const role of ["owner", "staff", "readonly"] as const) {
        await owner.query("INSERT INTO members (id,workspace_id,member_no,name,role,im_openids) VALUES ($1,$2,$3,$4,$5,$6)",
          [`mem-${role}-${workspace}`, workspace, `MEM-${role.toUpperCase()}`, "合成服务契约成员", role, JSON.stringify({ dingtalk: `openid-${role}-${workspace}` })]);
      }
    }
    const caller = (role: MemberRole = "owner", foreign = false) => {
      const claim = identity(role, foreign);
      return appRouter.createCaller({ session: claim, identity: claim, partnerIdentity: null, headers: new Headers() });
    };
    const scope = { tenantId, workspaceId };
    const counts = async (objectId?: string) => (await owner.query<{ events: number; approvals: number; ticket_events: number }>(`SELECT
      (SELECT count(*)::int FROM biz_events WHERE workspace_id=$1 AND ($2::text IS NULL OR payload->'object'->>'id'=$2)) AS events,
      (SELECT count(*)::int FROM approvals WHERE workspace_id=$1) AS approvals,
      (SELECT count(*)::int FROM c_ticket_events WHERE workspace_id=$1 AND ($2::text IS NULL OR ticket_id=$2)) AS ticket_events`,
      [workspaceId, objectId ?? null])).rows[0]!;
    const close = async () => {
      try { await db.closeAllPools(); }
      finally { restoreEnvironment(); }
    };
    return { db, owner, appRouter, tenantId, workspaceId, foreignWorkspaceId, identity, caller, scope, counts, close };
  } catch (primaryError) {
    try { await initializedDatabase?.closeAllPools(); }
    catch (cleanupError) { throw new AggregateError([primaryError, cleanupError], "服务测试夹具初始化失败且连接清理失败", { cause: primaryError }); }
    finally { restoreEnvironment(); }
    throw primaryError;
  }
}
