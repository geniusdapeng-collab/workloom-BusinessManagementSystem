/** Real PostgreSQL regression for the public fence proposal endpoint.
 * Fixtures are synthetic and live in a dedicated workspace. The append-only
 * events are preserved; this suite must run against a disposable test database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Identity } from "@workloom/base/tenancy";

const fault = vi.hoisted(() => ({ failApprovalInsert: false, failBindingWrite: false, failRollback: false, discarded: [] as Error[] }));
vi.mock("@workloom/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workloom/db")>();
  return {
    ...actual,
    getAppPool: (url?: string) => {
      const pool = actual.getAppPool(url);
      return new Proxy(pool, {
        get(target, property) {
          if (property !== "connect") return Reflect.get(target, property, target);
          return async () => {
            const client = await target.connect();
            return new Proxy(client, {
              get(connection, key) {
                if (key === "release") return (error?: Error | boolean) => {
                  if (error instanceof Error) fault.discarded.push(error);
                  connection.release(error);
                };
                if (key !== "query") {
                  const value = Reflect.get(connection, key, connection);
                  return typeof value === "function" ? value.bind(connection) : value;
                }
                return async (...args: unknown[]) => {
                  if (fault.failBindingWrite && /UPDATE fence_dry_runs SET report=jsonb_set/.test(String(args[0]))) {
                    fault.failBindingWrite = false;
                    throw new Error("synthetic report binding failure");
                  }
                  if (fault.failApprovalInsert && /INSERT INTO approvals/.test(String(args[0]))) {
                    fault.failApprovalInsert = false;
                    throw new Error("synthetic approval insert failure");
                  }
                  if (fault.failRollback && String(args[0]) === "ROLLBACK") {
                    fault.failRollback = false;
                    throw new Error("synthetic rollback transport failure");
                  }
                  return (connection.query as (...values: unknown[]) => unknown)(...args);
                };
              },
            });
          };
        },
      });
    },
  };
});

const enabled = process.env.RUN_DB_TESTS === "1"
  && Boolean(process.env.DATABASE_URL) && Boolean(process.env.DATABASE_APP_URL);

describe.runIf(enabled)("围栏提案真实 PostgreSQL 原子性与授权", () => {
  let db: typeof import("@workloom/db");
  let appRouter: typeof import("./router.js").appRouter;
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = `tenant-fence-${suffix}`;
  const workspaceId = `ws-fence-${suffix}`;
  const memberId = `mem-fence-${suffix}`;
  const readonlyId = `mem-fence-read-${suffix}`;
  const identity: Identity = { kind: "member", memberId, memberNo: "MEM-FENCE-1", name: "合成围栏测试负责人", role: "owner", tenantId, workspaceId, plan: "pro" };
  const candidate = (ruleId: string, values = {}) => ({ ruleId, name: "合成围栏规则", level: "review" as const, objectTypes: ["fixture"], actions: ["fixture.write"], when: "true", ...values });
  const caller = (claim = identity) => appRouter.createCaller({ session: claim, identity: claim, partnerIdentity: null, headers: new Headers() });
  const owner = () => db.getOwnerPool();
  const replay = (rule: ReturnType<typeof candidate>) => caller().fence.dryRun(rule);
  const snapshot = async (ruleId: string) => {
    const result = await owner().query(`SELECT
      (SELECT count(*)::int FROM fence_rules WHERE workspace_id=$1 AND rule_id=$2) AS rules,
      (SELECT count(*)::int FROM biz_events WHERE workspace_id=$1) AS events,
      (SELECT count(*)::int FROM approvals WHERE workspace_id=$1) AS approvals`, [workspaceId, ruleId]);
    return result.rows[0];
  };
  const pending = async (dryRunId: string) => (await owner().query("SELECT status FROM fence_dry_runs WHERE id=$1 AND workspace_id=$2", [dryRunId, workspaceId])).rows[0]?.status;
  beforeAll(async () => {
    db = await import("@workloom/db");
    ({ appRouter } = await import("./router.js"));
    await owner().query("INSERT INTO tenants (id,name,plan) VALUES ($1,$2,'pro')", [tenantId, "合成围栏测试租户"]);
    await owner().query("INSERT INTO workspaces (id,tenant_id,name,slug,industry,is_example) VALUES ($1,$2,$3,$4,'general',true)", [workspaceId, tenantId, "合成围栏测试工作区", `fence-${suffix}`]);
    await owner().query("INSERT INTO members (id,workspace_id,member_no,name,role) VALUES ($1,$2,$3,$4,'owner'),($5,$2,$6,$7,'readonly')", [memberId, workspaceId, identity.memberNo, identity.name, readonlyId, "MEM-FENCE-READ", "合成只读成员"]);
  });
  afterAll(async () => { fault.failApprovalInsert = false; fault.failBindingWrite = false; fault.failRollback = false; fault.discarded = []; await db?.closeAllPools(); });

  it("确认只落库完整、绑定已回放内容且携带版本的提案与审批", async () => {
    const rule = candidate("R99001");
    const dr = await replay(rule);
    const stored = await owner().query("SELECT report FROM fence_dry_runs WHERE id=$1", [dr.dryRunId]);
    expect(stored.rows[0].report.candidate).toEqual(rule);
    const result = await caller().fence.confirmDryRun({ dryRunId: dr.dryRunId, rule });
    expect(await pending(dr.dryRunId)).toBe("confirmed");
    const rows = await owner().query("SELECT id,version,status FROM fence_rules WHERE workspace_id=$1 AND rule_id=$2", [workspaceId, rule.ruleId]);
    expect(rows.rows).toEqual([{ id: `fr-r99001-v1-${workspaceId}`, version: "v1", status: "pending_approval" }]);
    const event = await owner().query("SELECT payload FROM biz_events WHERE event_id=$1 AND workspace_id=$2", [result.eventId, workspaceId]);
    expect(event.rows[0].payload.decision.after).toMatchObject({ ...rule, ruleRowId: rows.rows[0].id, version: "v1", dryRunId: dr.dryRunId, allowWhenChange: false });
    const approval = await owner().query("SELECT status,snapshot FROM approvals WHERE event_id=$1 AND workspace_id=$2", [result.eventId, workspaceId]);
    expect(approval.rows[0]).toMatchObject({ status: "pending", snapshot: { high_risk: true, after: { ruleRowId: rows.rows[0].id, version: "v1" } } });
  });
  it("同一规则并发提案分配不同递增版本，规范化大小写", async () => {
    const first = candidate("r99001"); const second = candidate("R99001", { name: "合成第二份规则" });
    const firstReplay = await replay(first); const secondReplay = await replay(second);
    await Promise.all([
      caller().fence.confirmDryRun({ dryRunId: firstReplay.dryRunId, rule: first }),
      caller().fence.confirmDryRun({ dryRunId: secondReplay.dryRunId, rule: second }),
    ]);
    const rows = await owner().query("SELECT id,version FROM fence_rules WHERE workspace_id=$1 AND rule_id='R99001' ORDER BY version", [workspaceId]);
    expect(rows.rows.map((row) => row.version)).toEqual(["v1", "v2", "v3"]);
    expect(new Set(rows.rows.map((row) => row.id)).size).toBe(3);
  });
  it("回放后替换名称或条件被拒，报告保持 pending 且无提案副作用", async () => {
    const rule = candidate("R99002"); const dr = await replay(rule); const before = await snapshot(rule.ruleId);
    await expect(caller().fence.confirmDryRun({ dryRunId: dr.dryRunId, rule: { ...rule, when: "false" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await pending(dr.dryRunId)).toBe("pending"); expect(await snapshot(rule.ruleId)).toEqual(before);
  });
  it("报告不得用于另一规则，且不能读取另一个工作区的报告", async () => {
    const rule = candidate("R99003"); const dr = await replay(rule);
    await expect(caller().fence.confirmDryRun({ dryRunId: dr.dryRunId, rule: candidate("R99004") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const foreign = { ...identity, workspaceId: `${workspaceId}-foreign` };
    await expect(caller(foreign).fence.confirmDryRun({ dryRunId: dr.dryRunId, rule })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(await pending(dr.dryRunId)).toBe("pending");
  });
  it("重复确认失败关闭，不重复创建规则、事件或审批", async () => {
    const rule = candidate("R99005"); const dr = await replay(rule);
    await caller().fence.confirmDryRun({ dryRunId: dr.dryRunId, rule }); const before = await snapshot(rule.ruleId);
    await expect(caller().fence.confirmDryRun({ dryRunId: dr.dryRunId, rule })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await snapshot(rule.ruleId)).toEqual(before);
  });
  it("当前生效规则不得降级；显式 when 放行位也不能绕过 level 守卫", async () => {
    const rule = candidate("R99006", { level: "auto" as const });
    await owner().query("INSERT INTO fence_rules (id,rule_id,version,workspace_id,name,level,match_spec,action,is_baseline,status,created_by) VALUES ($1,$2,'v1',$3,'合成下界','block',$4,$5,false,'active',$6)", [`fr-r99006-v1-${workspaceId}`, rule.ruleId, workspaceId, JSON.stringify({ object_types: rule.objectTypes, actions: rule.actions, when: rule.when }), JSON.stringify({ result: "block" }), identity.memberNo]);
    const dr = await replay(rule); const before = await snapshot(rule.ruleId);
    await expect(caller().fence.confirmDryRun({ dryRunId: dr.dryRunId, rule, allowWhenChange: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await pending(dr.dryRunId)).toBe("pending"); expect(await snapshot(rule.ruleId)).toEqual(before);
  });
  it("已回放的 when 修改须显式确认，放行位随提案保存供激活复核", async () => {
    const rule = candidate("R99007", { when: "false" });
    await owner().query("INSERT INTO fence_rules (id,rule_id,version,workspace_id,name,level,match_spec,action,is_baseline,status,created_by) VALUES ($1,$2,'v1',$3,'合成条件下界','review',$4,$5,false,'active',$6)", [`fr-r99007-v1-${workspaceId}`, rule.ruleId, workspaceId, JSON.stringify({ object_types: rule.objectTypes, actions: rule.actions, when: "true" }), JSON.stringify({ result: "review" }), identity.memberNo]);
    const dr = await replay(rule);
    await expect(caller().fence.confirmDryRun({ dryRunId: dr.dryRunId, rule })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await pending(dr.dryRunId)).toBe("pending");
    const result = await caller().fence.confirmDryRun({ dryRunId: dr.dryRunId, rule, allowWhenChange: true });
    const event = await owner().query("SELECT payload FROM biz_events WHERE event_id=$1", [result.eventId]);
    expect(event.rows[0].payload.decision.after.allowWhenChange).toBe(true);
  });
  it("审批入库失败回滚 dry-run 确认、规则与事件，允许重新确认", async () => {
    const rule = candidate("R99008"); const dr = await replay(rule); const before = await snapshot(rule.ruleId);
    fault.failApprovalInsert = true;
    await expect(caller().fence.confirmDryRun({ dryRunId: dr.dryRunId, rule })).rejects.toThrow("synthetic approval insert failure");
    expect(await pending(dr.dryRunId)).toBe("pending"); expect(await snapshot(rule.ruleId)).toEqual(before);
    await expect(caller().fence.confirmDryRun({ dryRunId: dr.dryRunId, rule })).resolves.toMatchObject({ proposed: true });
  });
  it("报告绑定与回滚同时失败保留两个错误、丢弃连接，未绑定报告不能确认", async () => {
    const rule = candidate("R99012"); const before = await snapshot(rule.ruleId);
    const discardedBefore = fault.discarded.length;
    fault.failBindingWrite = true; fault.failRollback = true;
    const error = await caller().fence.dryRun(rule).then(() => null, (rejection: Error & { cause?: unknown }) => rejection);
    expect(error?.cause).toBeInstanceOf(AggregateError);
    expect((error?.cause as AggregateError).errors.map((item: Error) => item.message)).toEqual(["synthetic report binding failure", "synthetic rollback transport failure"]);
    expect(fault.discarded.length).toBe(discardedBefore + 1);
    expect(fault.discarded.at(-1)?.message).toBe("synthetic rollback transport failure");
    const result = await owner().query("SELECT id,report,status FROM fence_dry_runs WHERE workspace_id=$1 AND rule_id=$2", [workspaceId, rule.ruleId]);
    expect(result.rows).toHaveLength(1); expect(result.rows[0].report.candidate).toBeUndefined(); expect(result.rows[0].status).toBe("pending");
    await expect(caller().fence.confirmDryRun({ dryRunId: result.rows[0].id, rule })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await snapshot(rule.ruleId)).toEqual(before);
    const fresh = await replay(rule); await expect(caller().fence.confirmDryRun({ dryRunId: fresh.dryRunId, rule })).resolves.toMatchObject({ proposed: true });
  });
  it("提案与回滚同时失败保留两个错误、丢弃连接且整笔写入未提交", async () => {
    const rule = candidate("R99013"); const dr = await replay(rule); const before = await snapshot(rule.ruleId);
    const discardedBefore = fault.discarded.length;
    fault.failApprovalInsert = true; fault.failRollback = true;
    const error = await caller().fence.confirmDryRun({ dryRunId: dr.dryRunId, rule }).then(() => null, (rejection: Error & { cause?: unknown }) => rejection);
    expect(error?.cause).toBeInstanceOf(AggregateError);
    expect((error?.cause as AggregateError).errors.map((item: Error) => item.message)).toEqual(["synthetic approval insert failure", "synthetic rollback transport failure"]);
    expect(fault.discarded.length).toBe(discardedBefore + 1);
    expect(await pending(dr.dryRunId)).toBe("pending"); expect(await snapshot(rule.ruleId)).toEqual(before);
    await expect(caller().fence.confirmDryRun({ dryRunId: dr.dryRunId, rule })).resolves.toMatchObject({ proposed: true });
  });
  it("只读成员不能通过 API 直接提出或确认规则", async () => {
    const rule = candidate("R99009"); const dr = await replay(rule);
    const readonly = { ...identity, memberId: readonlyId, memberNo: "MEM-FENCE-READ", role: "readonly" as const };
    await expect(caller(readonly).fence.dryRun(rule)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(readonly).fence.confirmDryRun({ dryRunId: dr.dryRunId, rule })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await pending(dr.dryRunId)).toBe("pending");
  });
  it("旧报告缺少候选内容时拒绝确认，要求重新回放", async () => {
    const rule = candidate("R99010"); const dryRunId = `fdr-legacy-${suffix}`;
    await owner().query("INSERT INTO fence_dry_runs (id,workspace_id,rule_id,rule_version,report,status,created_by) VALUES ($1,$2,$3,'v-next',$4,'pending',$5)", [dryRunId, workspaceId, rule.ruleId, JSON.stringify({ ruleId: rule.ruleId, replayed: 0 }), identity.memberNo]);
    await expect(caller().fence.confirmDryRun({ dryRunId, rule })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await pending(dryRunId)).toBe("pending");
  });
  it("空对象范围、空动作与异常规则标识在输入边界拒绝", async () => {
    await expect(caller().fence.dryRun(candidate("R99011", { objectTypes: [] }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().fence.dryRun(candidate("R99011", { actions: [""] }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().fence.dryRun(candidate("R99011; DROP TABLE fence_rules"))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
