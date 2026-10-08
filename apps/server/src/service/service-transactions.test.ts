import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@workloom/db", () => ({ getAppPool: () => state.pool }));
import { serviceTx, svcQuery } from "./events.js";

function fixture(faults: { query?: string; commit?: unknown; rollback?: unknown; tenant?: string | null } = {}) {
  const statements: Array<{ sql: string; params?: unknown[] }> = [];
  const releases: Array<Error | undefined> = [];
  const queryError = new Error("Synthetic query failure");
  const rows = [{ id: "synthetic-row" }];
  const client = {
    async query(sql: string, params?: unknown[]) {
      statements.push({ sql, params });
      if (sql === "COMMIT" && faults.commit !== undefined) throw faults.commit;
      if (sql === "ROLLBACK" && faults.rollback !== undefined) throw faults.rollback;
      if (faults.query && sql.includes(faults.query)) throw queryError;
      if (sql.includes("SELECT tenant_id")) return { rows: faults.tenant === null ? [] : [{ tenant_id: faults.tenant ?? "synthetic-tenant" }] };
      return { rows };
    },
    release(error?: Error) { releases.push(error); },
  };
  state.pool = { connect: async () => client };
  return { statements, releases, queryError, rows };
}

describe("MC-017 serviceTx transaction failure semantics (controlled client)", () => {
  it("success sets both RLS scopes, commits exactly once and returns only after COMMIT", async () => {
    const f = fixture();
    const value = await serviceTx("synthetic-workspace", async (_client, scope) => {
      expect(scope).toEqual({ tenantId: "synthetic-tenant", workspaceId: "synthetic-workspace" });
      expect(f.statements.at(-1)).toEqual({ sql: "SELECT set_config('app.tenant_id', $1, true)", params: ["synthetic-tenant"] });
      return "result";
    });
    expect(value).toBe("result");
    expect(f.statements[1]).toEqual({ sql: "SELECT set_config('app.workspace_id', $1, true)", params: ["synthetic-workspace"] });
    expect(f.statements.at(-1)?.sql).toBe("COMMIT");
    expect(f.statements.filter(statement => statement.sql === "COMMIT")).toHaveLength(1);
    expect(f.releases).toEqual([undefined]);
  });
  it("callback failure rolls back without COMMIT and preserves the original error", async () => {
    const f = fixture(), primary = new Error("Synthetic callback failure");
    await expect(serviceTx("synthetic-workspace", async () => { throw primary; })).rejects.toBe(primary);
    expect(f.statements.at(-1)?.sql).toBe("ROLLBACK");
    expect(f.statements.some(statement => statement.sql === "COMMIT")).toBe(false);
    expect(f.releases).toEqual([undefined]);
  });
  it("query failure in callback rolls back and preserves DB error identity", async () => {
    const f = fixture({ query: "SELECT synthetic-business" });
    await expect(serviceTx("synthetic-workspace", async client => client.query("SELECT synthetic-business"))).rejects.toBe(f.queryError);
    expect(f.statements.at(-1)?.sql).toBe("ROLLBACK");
    expect(f.statements.some(statement => statement.sql === "COMMIT")).toBe(false);
  });
  it("COMMIT failure rejects, attempts ROLLBACK and never commits twice", async () => {
    const primary = new Error("Synthetic COMMIT failure"), f = fixture({ commit: primary });
    await expect(serviceTx("synthetic-workspace", async () => "result")).rejects.toBe(primary);
    expect(f.statements.slice(-2).map(statement => statement.sql)).toEqual(["COMMIT", "ROLLBACK"]);
    expect(f.releases).toEqual([undefined]);
  });
  it("COMMIT and ROLLBACK failures retain both causes and discard the failed connection", async () => {
    const primary = new Error("Synthetic COMMIT failure"), cleanup = new Error("Synthetic ROLLBACK failure");
    const f = fixture({ commit: primary, rollback: cleanup });
    const error = await serviceTx("synthetic-workspace", async () => "result").catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([primary, cleanup]);
    expect(error.cause).toBe(primary);
    expect(f.statements.filter(statement => statement.sql === "COMMIT")).toHaveLength(1);
    expect(f.releases).toEqual([cleanup]);
  });
  it("callback and ROLLBACK failures also retain both causes and discard", async () => {
    const primary = new Error("Synthetic callback failure"), cleanup = new Error("Synthetic ROLLBACK failure");
    const f = fixture({ rollback: cleanup });
    const error = await serviceTx("synthetic-workspace", async () => { throw primary; }).catch(error => error);
    expect(error.errors).toEqual([primary, cleanup]);
    expect(error.cause).toBe(primary);
    expect(f.releases).toEqual([cleanup]);
    expect(f.statements.some(statement => statement.sql === "COMMIT")).toBe(false);
  });
  it("a non-Error cleanup failure stays in AggregateError and release receives an Error", async () => {
    const primary = new Error("Synthetic callback failure"), f = fixture({ rollback: "synthetic disconnect" });
    const error = await serviceTx("synthetic-workspace", async () => { throw primary; }).catch(error => error);
    expect(error.errors).toEqual([primary, "synthetic disconnect"]);
    expect(error.cause).toBe(primary);
    expect(f.releases[0]).toBeInstanceOf(Error);
    expect(f.releases[0]?.message).toBe("synthetic disconnect");
  });
  it("missing workspace fails before callback or COMMIT and rolls back", async () => {
    const f = fixture({ tenant: null }), callback = vi.fn();
    await expect(serviceTx("synthetic-workspace", callback)).rejects.toThrow("工作区不存在");
    expect(callback).not.toHaveBeenCalled();
    expect(f.statements.at(-1)?.sql).toBe("ROLLBACK");
    expect(f.statements.some(statement => statement.sql === "COMMIT")).toBe(false);
  });
  it("workspace RLS setup failure fails before callback and rolls back", async () => {
    const f = fixture({ query: "set_config('app.workspace_id'" }), callback = vi.fn();
    await expect(serviceTx("synthetic-workspace", callback)).rejects.toBe(f.queryError);
    expect(callback).not.toHaveBeenCalled();
    expect(f.statements.at(-1)?.sql).toBe("ROLLBACK");
  });
  it("BEGIN failure still attempts ROLLBACK and preserves the primary failure", async () => {
    const f = fixture({ query: "BEGIN" }), callback = vi.fn();
    await expect(serviceTx("synthetic-workspace", callback)).rejects.toBe(f.queryError);
    expect(callback).not.toHaveBeenCalled();
    expect(f.statements.map(statement => statement.sql)).toEqual(["BEGIN", "ROLLBACK"]);
  });
  it("connection failure rejects before any query or release", async () => {
    const primary = new Error("Synthetic connection failure");
    state.pool = { connect: async () => { throw primary; } };
    const callback = vi.fn();
    await expect(serviceTx("synthetic-workspace", callback)).rejects.toBe(primary);
    expect(callback).not.toHaveBeenCalled();
  });
  it("svcQuery uses the same scoped transaction and propagates selected rows", async () => {
    const f = fixture();
    await expect(svcQuery("synthetic-workspace", "SELECT synthetic-row", ["input"])).resolves.toEqual(f.rows);
    expect(f.statements.at(-2)).toEqual({ sql: "SELECT synthetic-row", params: ["input"] });
    expect(f.statements.at(-1)?.sql).toBe("COMMIT");
    expect(f.releases).toEqual([undefined]);
  });
});
