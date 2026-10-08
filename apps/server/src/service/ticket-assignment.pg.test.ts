/** MC-015：真实 PG 的分派、同值重试、改派与失败原子性。 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServiceContractPgFixture, serviceContractPgUrl, type ServiceContractPgFixture } from "./service-contract-pg-fixture.js";
import { assignTicketOn } from "./ticket.js";
import { serviceTx, appendEventOn } from "./events.js";

describe.runIf(Boolean(serviceContractPgUrl))("MC-015 工单分派真实 PostgreSQL 契约", () => {
  let fixture: ServiceContractPgFixture; let counter = 0;
  const fresh = async (status = "created", foreign = false) => {
    counter += 1; const id = `ticket-assignment-${fixture.workspaceId}-${counter}`;
    await fixture.owner.query("INSERT INTO c_tickets (id,workspace_id,kind,title,status,payload) VALUES ($1,$2,'other',$3,$4,'{}')",
      [id, foreign ? fixture.foreignWorkspaceId : fixture.workspaceId, "合成派单测试", status]);
    return id;
  };
  const assignment = { dept: "合成售后支持组", assignee: "MEM-STAFF" };
  beforeAll(async () => { fixture = await createServiceContractPgFixture("ticket-assignment"); });
  afterAll(async () => { await fixture?.close(); });

  it("created 首次分派状态与真实人类归因同事务落两本账", async () => {
    const id = await fresh(); const before = await fixture.counts(id);
    const result = await fixture.caller().service.tickets.assign({ ticketId: id, ...assignment });
    expect(result).toMatchObject({ deduped: false, ticket: { id, status: "assigned", ...assignment } });
    expect(await fixture.counts(id)).toMatchObject({ events: before.events + 1, ticket_events: before.ticket_events + 1 });
    const event = (await fixture.owner.query("SELECT actor_type,actor_id,detail FROM c_ticket_events WHERE ticket_id=$1", [id])).rows[0];
    expect(event).toMatchObject({ actor_type: "staff", actor_id: "MEM-OWNER", detail: { ...assignment, before: { dept: null, assignee: null } } });
  });
  it("assigned 同值与省略输入保持原值、时间和两本账不变", async () => {
    const id = await fresh(); const first = await fixture.caller().service.tickets.assign({ ticketId: id, ...assignment });
    const before = await fixture.counts(id);
    for (const input of [{ ticketId: id, ...assignment }, { ticketId: id }, { ticketId: id, assignee: assignment.assignee }]) {
      const result = await fixture.caller().service.tickets.assign(input);
      expect(result.deduped).toBe(true); expect(result.ticket.updatedAt).toBe(first.ticket.updatedAt); expect(result.ticket).toMatchObject(assignment);
    }
    expect(await fixture.counts(id)).toEqual(before);
  });
  it("改部门或负责人各仅新增一次原地分派留痕，不跳过后续状态机", async () => {
    const id = await fresh(); await fixture.caller().service.tickets.assign({ ticketId: id, ...assignment }); const before = await fixture.counts(id);
    const department = await fixture.caller().service.tickets.assign({ ticketId: id, dept: "合成工程复核组" });
    expect(department).toMatchObject({ deduped: false, ticket: { status: "assigned", dept: "合成工程复核组", assignee: "MEM-STAFF" } });
    await fixture.caller().service.tickets.assign({ ticketId: id, assignee: "MEM-OWNER" });
    expect(await fixture.counts(id)).toMatchObject({ events: before.events + 2, ticket_events: before.ticket_events + 2 });
    expect((await fixture.caller().service.tickets.advance({ ticketId: id, action: "start" })).ticket.status).toBe("processing");
  });
  it.each(["processing", "done", "closed"])("%s 再分派为 CONFLICT 409，零工单/业务事件副作用", async (status) => {
    const id = await fresh(status); const before = await fixture.counts(id);
    await expect(fixture.caller().service.tickets.assign({ ticketId: id, ...assignment })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("非法迁移") });
    expect((await fixture.owner.query("SELECT status FROM c_tickets WHERE id=$1", [id])).rows[0].status).toBe(status);
    expect(await fixture.counts(id)).toEqual(before);
  });
  it("缺失或跨工作区工单为 NOT_FOUND，不返回别区工单", async () => {
    const foreign = await fresh("created", true); const before = await fixture.counts();
    for (const id of ["missing-ticket", foreign]) await expect(fixture.caller().service.tickets.assign({ ticketId: id, ...assignment })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await fixture.counts()).toEqual(before);
  });
  it("readonly、细粒度 deny 与空/超长参数拒绝，不写两本账", async () => {
    const id = await fresh(); const before = await fixture.counts(id);
    await expect(fixture.caller("readonly").service.tickets.assign({ ticketId: id, ...assignment })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await fixture.owner.query("UPDATE members SET permissions=$2 WHERE id=$1", [fixture.identity().memberId, JSON.stringify({ deny: ["workspace.write"] })]);
    await expect(fixture.caller().service.tickets.assign({ ticketId: id, ...assignment })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await fixture.owner.query("UPDATE members SET permissions='{}' WHERE id=$1", [fixture.identity().memberId]);
    for (const input of [{ ticketId: "" }, { ticketId: id, dept: " " }, { ticketId: id, assignee: "a".repeat(81) }]) {
      await expect(fixture.caller().service.tickets.assign(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await fixture.counts(id)).toEqual(before);
  });
  it("同值并发争用只写一次，Unicode/标点按数据保存", async () => {
    const id = await fresh(); const input = { ticketId: id, dept: "售后 <复核> & 项目组", assignee: "负责人·张（合成）" };
    const results = await Promise.all(Array.from({ length: 6 }, () => fixture.caller().service.tickets.assign(input)));
    expect(results.filter((result) => !result.deduped).length).toBe(1);
    expect(await fixture.counts(id)).toMatchObject({ events: 1, ticket_events: 1 });
    expect(results.every((result) => result.ticket.dept === input.dept && result.ticket.assignee === input.assignee)).toBe(true);
  });
  it("分派及两账已写后抛错，状态和事件全部回滚，重试可恢复", async () => {
    const id = await fresh(); const before = await fixture.counts(id);
    await expect(serviceTx(fixture.workspaceId, async (client, scope) => {
      const ticket = await assignTicketOn(client, { workspaceId: fixture.workspaceId, ticketId: id, ...assignment, actorType: "staff", actorId: "MEM-OWNER" });
      await appendEventOn(client, scope, { id: "MEM-OWNER", type: "human" }, { objectType: "ticket", objectId: ticket.id, action: "service.ticket.assign", after: assignment });
      throw new Error("synthetic ticket transaction after-write failure");
    })).rejects.toThrow("synthetic ticket transaction after-write failure");
    expect((await fixture.owner.query("SELECT status,dept,assignee FROM c_tickets WHERE id=$1", [id])).rows[0]).toEqual({ status: "created", dept: null, assignee: null });
    expect(await fixture.counts(id)).toEqual(before);
    expect((await fixture.caller().service.tickets.assign({ ticketId: id, ...assignment })).deduped).toBe(false);
  });
});
