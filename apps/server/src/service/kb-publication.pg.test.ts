/** MC-014：真实 PG/RLS 与公共 router 的知识发布、事务和跨通道负向断言。 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createServiceContractPgFixture, serviceContractPgUrl, type ServiceContractPgFixture } from "./service-contract-pg-fixture.js";
import {
  KB_PUBLICATION_PROJECTION, publishDocumentOn, projectKbPublicationDecisionOn, registerKbPublicationProjection,
} from "./kb-publication.js";
import { serviceTx } from "./events.js";
import { upsertDocument, setDocumentStatus, listDocuments } from "./kb.js";
import { decide, batchApprove, registerApprovalTransactionProjection } from "@workloom/base/review-console";
import { handleGestureCallback } from "@workloom/base/im-channels";

describe.runIf(Boolean(serviceContractPgUrl))("MC-014 知识发布真实 PostgreSQL 契约", () => {
  let fixture: ServiceContractPgFixture;
  let collectionId: string;
  let counter = 0;
  const fresh = async (content = "需要逐条人工审核的公开知识。") => {
    counter += 1;
    return fixture.caller().service.kb.upsertDocument({ collectionId, title: `合成知识-${counter}`, sourceKind: "manual", contentMd: `## 合成政策-${counter}\n\n${content}` });
  };
  const document = async (id: string) => (await fixture.owner.query("SELECT id,version,hash,status FROM kb_documents WHERE workspace_id=$1 AND id=$2", [fixture.workspaceId, id])).rows[0];
  const pending = async (approvalId: string) => {
    await fixture.owner.query("UPDATE approvals SET status='pending',gesture=NULL,decided_by=NULL,decided_at=NULL WHERE workspace_id=$1 AND approval_id=$2", [fixture.workspaceId, approvalId]);
  };
  beforeAll(async () => {
    fixture = await createServiceContractPgFixture("kb-publication");
    collectionId = (await fixture.caller().service.kb.createCollection({ name: "合成知识审核库" })).collection.id;
  });
  afterEach(() => { registerKbPublicationProjection(); });
  afterAll(async () => { await fixture?.close(); });

  it("逐条发布保存 approved 手势、决策人、内容版本与原子事件，重复点击不写第二份", async () => {
    const created = await fresh();
    const result = await fixture.caller().service.kb.approveDocument({ documentId: created.documentId });
    expect(result).toMatchObject({ ok: true, status: "active", deduped: false, version: 1 });
    const audit = (await fixture.owner.query("SELECT status,decided_by,decided_at,gesture,snapshot,event_id FROM approvals WHERE approval_id=$1", [result.approvalId])).rows[0];
    expect(audit).toMatchObject({ status: "approved", decided_by: "MEM-OWNER", gesture: { type: "approve", weight: 1 }, event_id: result.eventId,
      snapshot: { post_hoc: true, projection: { kind: KB_PUBLICATION_PROJECTION }, after: { documentId: created.documentId, version: 1, hash: (await document(created.documentId)).hash } } });
    expect(audit.decided_at).not.toBeNull();
    const before = await fixture.counts(created.documentId);
    expect(await fixture.caller().service.kb.approveDocument({ documentId: created.documentId })).toEqual({ ...result, deduped: true });
    expect(await fixture.counts(created.documentId)).toEqual(before);
  });

  it("setStatus(active) 复用有批准记录的发布通道，低层状态助手拒绝静默启用", async () => {
    const created = await fresh();
    const result = await fixture.caller().service.kb.setStatus({ documentId: created.documentId, status: "active" });
    expect(result).toMatchObject({ ok: true, status: "active", deduped: false });
    const audit = await fixture.owner.query("SELECT status,decided_by FROM approvals WHERE event_id=$1", [(result as { eventId: string }).eventId]);
    expect(audit.rows).toEqual([{ status: "approved", decided_by: "MEM-OWNER" }]);
    const blocked = await fresh(); const before = await fixture.counts(blocked.documentId);
    await expect(setDocumentStatus({ workspaceId: fixture.workspaceId, documentId: blocked.documentId, status: "active" })).rejects.toMatchObject({ code: "INVALID_PROJECTION" });
    expect((await document(blocked.documentId)).status).toBe("pending_review");
    expect(await fixture.counts(blocked.documentId)).toEqual(before);
  });

  it("真实 decide 驳回退出检索，重新人工发布创建新审批，旧记录不能反转最新发布", async () => {
    const created = await fresh("低置信内容需审核后撤回。");
    const published = await fixture.caller().service.kb.approveDocument({ documentId: created.documentId });
    await pending(published.approvalId);
    const rejected = await fixture.caller().approvals.decide({ approvalId: published.approvalId, gesture: "reject", reasonEnum: "fixture.fact_wrong", reasonText: "合成审核撤回" });
    expect(rejected.status).toBe("rejected");
    expect((await document(created.documentId)).status).toBe("pending_review");
    const hits = (await fixture.caller().service.kb.search({ query: "低置信内容需审核后撤回", limit: 20 })).hits;
    expect(hits.some((hit) => hit.documentId === created.documentId)).toBe(false);
    const republished = await fixture.caller().service.kb.approveDocument({ documentId: created.documentId });
    expect(republished.deduped).toBe(false); expect(republished.eventId).not.toBe(published.eventId);
    await pending(published.approvalId); const before = await fixture.counts(created.documentId);
    await expect(fixture.caller().approvals.decide({ approvalId: published.approvalId, gesture: "reject", reasonEnum: "fixture.fact_wrong" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await document(created.documentId)).status).toBe("active"); expect(await fixture.counts(created.documentId)).toEqual(before);
  });

  it("新版本回到 pending_review，旧批准或驳回按 version/hash 拒绝且不能改动新切块", async () => {
    const created = await fresh(); const published = await fixture.caller().service.kb.approveDocument({ documentId: created.documentId });
    const current = (await listDocuments({ workspaceId: fixture.workspaceId })).find((doc) => doc.id === created.documentId)!;
    await upsertDocument({ workspaceId: fixture.workspaceId, collectionId, title: current.title, sourceKind: "manual", contentMd: "## 合成新版本\n\n未经任何审批的新知识内容。" });
    expect(await document(created.documentId)).toMatchObject({ version: 2, status: "pending_review" });
    await pending(published.approvalId); const before = await fixture.counts(created.documentId);
    for (const gesture of ["approve", "reject"] as const) {
      await expect(fixture.caller().approvals.decide({ approvalId: published.approvalId, gesture, ...(gesture === "reject" ? { reasonEnum: "fixture.fact_wrong" } : {}) })).rejects.toMatchObject({ code: "CONFLICT" });
    }
    expect(await fixture.counts(created.documentId)).toEqual(before);
    const blocks = await fixture.owner.query("SELECT content FROM kb_chunks WHERE document_id=$1", [created.documentId]);
    expect(blocks.rows[0].content).toContain("未经任何审批");
    const second = await fixture.caller().service.kb.approveDocument({ documentId: created.documentId });
    expect(second.version).toBe(2); expect(second.deduped).toBe(false);
  });

  it("同版本 hash 被改、快照改绑另一文档与正文 edit 越过建版均被拒绝", async () => {
    const created = await fresh(); const published = await fixture.caller().service.kb.approveDocument({ documentId: created.documentId });
    await pending(published.approvalId); const original = await document(created.documentId);
    await fixture.owner.query("UPDATE kb_documents SET hash=$2 WHERE id=$1", [created.documentId, createHash("sha256").update("tampered").digest("hex")]);
    await expect(fixture.caller().approvals.decide({ approvalId: published.approvalId, gesture: "approve" })).rejects.toMatchObject({ code: "CONFLICT" });
    await fixture.owner.query("UPDATE kb_documents SET hash=$2 WHERE id=$1", [created.documentId, original.hash]);
    await fixture.owner.query("UPDATE approvals SET snapshot=jsonb_set(snapshot,'{after,documentId}',$2::jsonb) WHERE approval_id=$1", [published.approvalId, JSON.stringify("foreign-document")]);
    await expect(fixture.caller().approvals.decide({ approvalId: published.approvalId, gesture: "approve" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await fixture.owner.query("UPDATE approvals SET snapshot=jsonb_set(snapshot,'{after,documentId}',$2::jsonb) WHERE approval_id=$1", [published.approvalId, JSON.stringify(created.documentId)]);
    await expect(fixture.caller().approvals.decide({ approvalId: published.approvalId, gesture: "edit", editedAfter: { contentMd: "直接替换正文" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await fixture.owner.query("SELECT status FROM approvals WHERE approval_id=$1", [published.approvalId])).rows[0].status).toBe("pending");
  });

  it("required projection 未注册时 direct decide 和批量失败关闭且无状态/账本副作用", async () => {
    const created = await fresh(); const published = await fixture.caller().service.kb.approveDocument({ documentId: created.documentId });
    await pending(published.approvalId);
    registerKbPublicationProjection()();
    const before = await fixture.counts(created.documentId);
    await expect(decide(fixture.db.getAppPool(), fixture.db.getGatewayPool(), fixture.scope, { memberNo: "MEM-OWNER", role: "owner" }, published.approvalId, { type: "approve" }))
      .rejects.toMatchObject({ code: "PROJECTION_UNAVAILABLE", statusCode: 412 });
    const batch = await batchApprove(fixture.db.getAppPool(), fixture.db.getGatewayPool(), fixture.scope, { memberNo: "MEM-OWNER", role: "owner" }, [published.approvalId]);
    expect(batch.approved).toEqual([]); expect(batch.skipped[0]!.reason).toContain("未注册");
    expect((await fixture.owner.query("SELECT status FROM approvals WHERE approval_id=$1", [published.approvalId])).rows[0].status).toBe("pending");
    expect(await fixture.counts(created.documentId)).toEqual(before);
  });

  it("投影已写文档后故障，审批、文档与两份事件仍同事务回滚", async () => {
    const created = await fresh(); const published = await fixture.caller().service.kb.approveDocument({ documentId: created.documentId });
    await pending(published.approvalId); await fixture.owner.query("UPDATE kb_documents SET status='pending_review' WHERE id=$1", [created.documentId]);
    const before = await fixture.counts(created.documentId);
    registerApprovalTransactionProjection(KB_PUBLICATION_PROJECTION, ["kb.publish"], async (client, input) => {
      await projectKbPublicationDecisionOn(client, input); throw new Error("synthetic projection after-write failure");
    });
    await expect(fixture.caller().approvals.decide({ approvalId: published.approvalId, gesture: "approve" })).rejects.toThrow("synthetic projection after-write failure");
    expect((await document(created.documentId)).status).toBe("pending_review");
    expect((await fixture.owner.query("SELECT status FROM approvals WHERE approval_id=$1", [published.approvalId])).rows[0].status).toBe("pending");
    expect(await fixture.counts(created.documentId)).toEqual(before);
  });

  it("直接人工发布的事务失败回滚生效状态、批准记录与五元事件", async () => {
    const created = await fresh(); const before = await fixture.counts(created.documentId);
    await expect(serviceTx(fixture.workspaceId, async (client, scope) => {
      await publishDocumentOn(client, scope, { documentId: created.documentId, memberNo: "MEM-OWNER" });
      throw new Error("synthetic publication commit boundary failure");
    })).rejects.toThrow("synthetic publication commit boundary failure");
    expect((await document(created.documentId)).status).toBe("pending_review"); expect(await fixture.counts(created.documentId)).toEqual(before);
  });

  it("owner/staff/readonly 与细粒度 deny 在 approve、setStatus 和 IM/direct decide 一致强制", async () => {
    const created = await fresh(); const before = await fixture.counts(created.documentId);
    await expect(fixture.caller("readonly").service.kb.approveDocument({ documentId: created.documentId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await fixture.owner.query("UPDATE members SET permissions=$2 WHERE id=$1", [fixture.identity().memberId, JSON.stringify({ deny: ["approval.decide"] })]);
    await expect(fixture.caller().service.kb.approveDocument({ documentId: created.documentId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(fixture.caller().service.kb.setStatus({ documentId: created.documentId, status: "active" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await fixture.counts(created.documentId)).toEqual(before);
    await fixture.owner.query("UPDATE members SET permissions='{}' WHERE id=$1", [fixture.identity().memberId]);
    const published = await fixture.caller("staff").service.kb.approveDocument({ documentId: created.documentId }); await pending(published.approvalId);
    await fixture.owner.query("UPDATE members SET permissions=$2 WHERE id=$1", [fixture.identity("staff").memberId, JSON.stringify({ deny: ["approval.decide"] })]);
    await expect(handleGestureCallback(fixture.db.getAppPool(), fixture.db.getGatewayPool(), fixture.scope, { channel: "dingtalk", approvalId: published.approvalId,
      operatorOpenId: `openid-staff-${fixture.workspaceId}`, conversationId: "synthetic", gesture: "approve" })).rejects.toMatchObject({ code: "FORBIDDEN_ROLE" });
    await fixture.owner.query("UPDATE members SET permissions='{}' WHERE id=$1", [fixture.identity("staff").memberId]);
  });

  it("批量批准、IM 拒绝与旧快照兼容共用同一文档投影，回调重试只执行一次", async () => {
    const created = await fresh(); const published = await fixture.caller().service.kb.approveDocument({ documentId: created.documentId }); await pending(published.approvalId);
    await fixture.owner.query("UPDATE kb_documents SET status='pending_review' WHERE id=$1", [created.documentId]);
    const batch = await fixture.caller().approvals.batchApprove({ approvalIds: [published.approvalId] });
    expect(batch.approved).toEqual([published.approvalId]); expect((await document(created.documentId)).status).toBe("active");
    await pending(published.approvalId);
    await fixture.owner.query("UPDATE approvals SET snapshot=snapshot-'projection' WHERE approval_id=$1", [published.approvalId]);
    const callback = { channel: "dingtalk" as const, approvalId: published.approvalId, operatorOpenId: `openid-owner-${fixture.workspaceId}`, conversationId: "synthetic", gesture: "reject" as const, reasonEnum: "fixture.channel_wrong" };
    const result = await handleGestureCallback(fixture.db.getAppPool(), fixture.db.getGatewayPool(), fixture.scope, callback);
    expect(result.status).toBe("rejected"); expect((await document(created.documentId)).status).toBe("pending_review");
    const before = await fixture.counts(created.documentId);
    expect((await handleGestureCallback(fixture.db.getAppPool(), fixture.db.getGatewayPool(), fixture.scope, callback)).deduped).toBe(true);
    expect(await fixture.counts(created.documentId)).toEqual(before);
  });

  it("并发人工发布只生成一份发布事件/批准，重复内容与并发同标题建版保持一条版本链", async () => {
    const created = await fresh(); const before = await fixture.counts(created.documentId);
    const results = await Promise.all(Array.from({ length: 5 }, () => fixture.caller().service.kb.approveDocument({ documentId: created.documentId })));
    expect(new Set(results.map((result) => result.eventId)).size).toBe(1); expect(results.filter((result) => !result.deduped).length).toBe(1);
    expect(await fixture.counts(created.documentId)).toMatchObject({ events: before.events + 1, approvals: before.approvals + 1 });
    const title = `合成并发版本链-${counter}`;
    const versions = await Promise.all(["第一份新正文", "第二份新正文"].map((body) => fixture.caller().service.kb.upsertDocument({ collectionId, title, sourceKind: "manual", contentMd: `## 并发\n\n${body}` })));
    expect(new Set(versions.map((result) => result.documentId)).size).toBe(1); expect(versions.map((result) => result.version).sort()).toEqual([1, 2]);
    expect((await document(versions[0]!.documentId)).status).toBe("pending_review");
  });

  it("空ID、不存在、跨工作区文档/集合均拒绝且不泄漏或写审计", async () => {
    const created = await fresh(); const before = await fixture.counts(created.documentId);
    await expect(fixture.caller().service.kb.approveDocument({ documentId: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(fixture.caller().service.kb.approveDocument({ documentId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(fixture.caller("owner", true).service.kb.approveDocument({ documentId: created.documentId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(fixture.caller("owner", true).service.kb.upsertDocument({ collectionId, title: "跨工作区集合拒绝", sourceKind: "manual", contentMd: "## 不能创建\n\n无越权写入。" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await fixture.counts(created.documentId)).toEqual(before);
  });
});
