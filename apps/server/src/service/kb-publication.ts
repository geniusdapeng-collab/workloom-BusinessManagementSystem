/** KB 发布：逐条人工裁决、审计与检索状态共用调用方事务。 */
import type pg from "pg";
import { GESTURE_WEIGHT, type BusinessEvent, type MemberRole, type PlanTier } from "@workloom/shared";
import {
  ApprovalError,
  registerApprovalTransactionProjection,
  type ApprovalTransactionProjectionInput,
} from "@workloom/base/review-console";
import { memberAccessGrants } from "./access-authority.js";
import { appendEventOn, type ServiceScope } from "./events.js";
import { ensureServiceSchema } from "./store.js";

export const KB_PUBLICATION_PROJECTION = "service.kb-publication-v1";

interface PublicationDocument { id: string; title: string; version: number; hash: string | null; status: string }

/** 事务内再查当前成员事实；旧 JWT、细粒度 deny 与 IM 回调不能绕过发布权限。 */
async function assertPublisherOn(client: pg.PoolClient, scope: ServiceScope, memberNo: string): Promise<void> {
  const result = await client.query<{
    role: MemberRole; plan: PlanTier; permissions: Record<string, unknown>; member_status: string; tenant_status: string;
  }>(
    `SELECT m.role, m.permissions, m.status AS member_status, t.plan, t.status AS tenant_status
       FROM members m JOIN workspaces w ON w.id=m.workspace_id JOIN tenants t ON t.id=w.tenant_id
      WHERE m.workspace_id=$1 AND m.member_no=$2 AND w.tenant_id=$3 FOR SHARE OF m, t`,
    [scope.workspaceId, memberNo, scope.tenantId],
  );
  const row = result.rows[0];
  const grants = row && memberAccessGrants({ role: row.role, plan: row.plan, guest: memberNo === "GUEST", permissions: row.permissions ?? {} });
  if (!row || row.member_status !== "active" || row.tenant_status !== "active"
    || !grants?.actionPermissions.includes("workspace.write") || !grants.actionPermissions.includes("approval.decide")) {
    throw new ApprovalError("FORBIDDEN_ROLE", "当前成员没有知识发布与审批裁决权限");
  }
}

function afterOf(event: BusinessEvent): Record<string, unknown> {
  const after = event.decision.after;
  return after && typeof after === "object" && !Array.isArray(after) ? after as Record<string, unknown> : {};
}

export interface KbPublicationResult {
  ok: true; status: "active"; eventId: string; approvalId: string; version: number; deduped: boolean;
}

export async function publishDocumentOn(
  client: pg.PoolClient,
  scope: ServiceScope,
  input: { documentId: string; memberNo: string },
): Promise<KbPublicationResult> {
  await ensureServiceSchema();
  await assertPublisherOn(client, scope, input.memberNo);
  const found = await client.query<PublicationDocument>(
    `SELECT id, title, version, hash, status FROM kb_documents WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
    [scope.workspaceId, input.documentId],
  );
  const doc = found.rows[0];
  if (!doc) throw new ApprovalError("NOT_FOUND", `文档不存在：${input.documentId}`);
  const latest = await client.query<{ event_id: string; approval_id: string; status: string; payload: BusinessEvent }>(
    `SELECT e.event_id, a.approval_id, a.status, e.payload
       FROM biz_events e JOIN approvals a ON a.event_id=e.event_id AND a.workspace_id=e.workspace_id AND a.tenant_id=e.tenant_id
      WHERE e.workspace_id=$1 AND e.tenant_id=$2 AND e.payload->'object'->>'type'='kb_document'
        AND e.payload->'object'->>'id'=$3 AND e.payload->'decision'->>'action'='kb.publish' AND a.channel='inapp'
      ORDER BY e.seq DESC LIMIT 1`,
    [scope.workspaceId, scope.tenantId, doc.id],
  );
  const prior = latest.rows[0];
  const priorAfter = prior ? afterOf(prior.payload) : {};
  if (doc.status === "active" && prior && (prior.status === "approved" || prior.status === "edited")
    && priorAfter.version === doc.version && (priorAfter.hash === undefined || priorAfter.hash === doc.hash)) {
    return { ok: true, status: "active", eventId: prior.event_id, approvalId: prior.approval_id, version: doc.version, deduped: true };
  }
  const after = { documentId: doc.id, title: doc.title, version: doc.version, hash: doc.hash, status: "active", fence_action: "kb.publish" };
  const event = await appendEventOn(client, scope, { id: input.memberNo, type: "human" }, {
    objectType: "kb_document", objectId: doc.id, action: "kb.publish", after,
    basis: ["待审区逐条人工批准生效，发布与审批审计在同一事务提交"],
  });
  const approvalId = `apr-${event.eventId.toLowerCase()}`;
  await client.query(
    `INSERT INTO approvals (approval_id, tenant_id, workspace_id, event_id, channel, status, snapshot, gesture, decided_by, decided_at)
     VALUES ($1,$2,$3,$4,'inapp','approved',$5,$6,$7,now())`,
    [approvalId, scope.tenantId, scope.workspaceId, event.eventId,
      JSON.stringify({ before: { status: doc.status }, after, high_risk: false, post_hoc: true, projection: { kind: KB_PUBLICATION_PROJECTION } }),
      JSON.stringify({ type: "approve", weight: GESTURE_WEIGHT.approve }), input.memberNo],
  );
  await client.query(`UPDATE kb_documents SET status='active' WHERE workspace_id=$1 AND id=$2`, [scope.workspaceId, doc.id]);
  return { ok: true, status: "active", eventId: event.eventId, approvalId, version: doc.version, deduped: false };
}

/** 被审事件是对象与版本的权威来源；快照只能收紧，不能把审批改绑到其他文档。 */
export async function projectKbPublicationDecisionOn(client: pg.PoolClient, input: ApprovalTransactionProjectionInput): Promise<void> {
  await assertPublisherOn(client, input.scope, input.actor.memberNo);
  const { event, approval, gesture } = input;
  const after = afterOf(event);
  const snapshotAfter = approval.snapshot?.after as Record<string, unknown> | undefined;
  if (event.decision.action !== "kb.publish" || event.object.type !== "kb_document" || !event.object.id
    || event.context.workspace_id !== input.scope.workspaceId || event.context.tenant_id !== input.scope.tenantId
    || !Number.isSafeInteger(after.version) || Number(after.version) < 1
    || (snapshotAfter?.documentId !== undefined && snapshotAfter.documentId !== event.object.id)
    || (snapshotAfter?.version !== undefined && snapshotAfter.version !== after.version)
    || (snapshotAfter?.hash !== undefined && after.hash !== undefined && snapshotAfter.hash !== after.hash)) {
    throw new ApprovalError("INVALID_PROJECTION", "知识发布审批的对象或版本绑定无效");
  }
  const current = await client.query<PublicationDocument>(
    `SELECT id, title, version, hash, status FROM kb_documents WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
    [input.scope.workspaceId, event.object.id],
  );
  const doc = current.rows[0];
  if (!doc) throw new ApprovalError("NOT_FOUND", "知识发布审批的文档不存在");
  const latest = await client.query<{ event_id: string }>(
    `SELECT event_id FROM biz_events WHERE tenant_id=$1 AND workspace_id=$2 AND payload->'object'->>'type'='kb_document'
       AND payload->'object'->>'id'=$3 AND payload->'decision'->>'action'='kb.publish' ORDER BY seq DESC LIMIT 1`,
    [input.scope.tenantId, input.scope.workspaceId, doc.id],
  );
  const boundHash = snapshotAfter?.hash ?? after.hash;
  if (doc.version !== after.version || (boundHash !== undefined && boundHash !== doc.hash) || latest.rows[0]?.event_id !== approval.event_id) {
    throw new ApprovalError("STALE_PROJECTION", "知识内容或发布记录已更新，旧审批不能改变当前版本，请重新审核");
  }
  if (gesture.type === "edit") {
    // 知识正文更新须先经过 upsertDocument 的新版本与切块重建，再由新审批发布。
    const edited = gesture.editedAfter;
    if (!edited || typeof edited !== "object" || Array.isArray(edited)
      || Object.keys(edited).some((key) => !["documentId", "version", "hash", "status"].includes(key))
      || (edited as Record<string, unknown>).documentId !== doc.id
      || (edited as Record<string, unknown>).version !== doc.version
      || (edited as Record<string, unknown>).hash !== doc.hash
      || (edited as Record<string, unknown>).status !== "active") {
      throw new ApprovalError("INVALID_PROJECTION", "编辑后的知识审批必须绑定当前文档、版本和内容指纹；正文改动须先提交新版本");
    }
  }
  await client.query(`UPDATE kb_documents SET status=$3 WHERE workspace_id=$1 AND id=$2`,
    [input.scope.workspaceId, doc.id, gesture.type === "reject" ? "pending_review" : "active"]);
}

/** 由行业组合根模块加载时执行，覆盖单笔、批量与 IM 的同一 decide 实现。 */
export function registerKbPublicationProjection(): () => void {
  return registerApprovalTransactionProjection(KB_PUBLICATION_PROJECTION, ["kb.publish"], projectKbPublicationDecisionOn);
}
