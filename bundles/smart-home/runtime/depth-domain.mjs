import { assert, digest, clone, validate } from './errors.mjs';
import { ENTITY_TYPES } from './catalogue.mjs';
import { LEAD_PATCH_SCHEMA, DEPTH_ENTITY_TYPES } from './depth-catalogue.mjs';
import { EMPLOYEES } from './workforce.mjs';
import { readIndustryContext } from './assets.mjs';

const fields = (input, ...keys) => Object.fromEntries(Object.entries(input).filter(([key]) => !['idempotencyKey', ...keys].includes(key)));
export const LEAD_HANDOFF_FIELDS = Object.freeze(['alias', 'contactRef', 'buildingRef', 'intent', 'budgetCents', 'renovationStage', 'serviceArea']);
export function leadCompleteness(lead) {
  const known = { ...lead, alias: lead.alias ?? lead.surname, contactRef: lead.contactRef ?? lead.phoneRef ?? lead.wechatRef, buildingRef: lead.buildingRef ?? lead.buildingName };
  const missingFields = LEAD_HANDOFF_FIELDS.filter(key => known[key] === undefined || known[key] === '' || (key === 'budgetCents' && known[key] <= 0));
  const permissionsMissing = ['consultation', 'appointment'].filter(purpose => lead.consent?.status !== 'granted' || !lead.consent.purposes.includes(purpose));
  return { missingFields, permissionsMissing, handoffReady: missingFields.length === 0 && permissionsMissing.length === 0, factsKnown: LEAD_HANDOFF_FIELDS.length - missingFields.length, factsTotal: LEAD_HANDOFF_FIELDS.length, computedFromRecordedFields: true };
}

export class BusinessDepth {
  constructor(domain) { this.d = domain; this.s = domain.s; }
  read(operation, input) {
    if (operation === 'industry.context') return readIndustryContext(input.section);
    return undefined;
  }
  get(type, id) { return this.d.get(type, id); }
  snapshot(type, id) { const record = this.get(type, id); return { type, id, version: record.version, digest: digest(record) }; }
  checkSnapshots(references) {
    for (const reference of references) {
      const current = this.get(reference.type, reference.id);
      assert(current.version === reference.version && digest(current) === reference.digest, 'DOCUMENT_REFERENCE_STALE', 'A referenced customer or engineering record changed; create a new document revision', 409, { type: reference.type, id: reference.id, expectedVersion: reference.version, actualVersion: current.version });
    }
  }
  source(source, actor) {
    assert(source !== 'model-proposal', 'CUSTOMER_FACT_CONFIRMATION_REQUIRED', 'A model proposal cannot be stored as a confirmed customer dossier', 403);
    if (source === 'synthetic-history') assert(this.d.syntheticHistory, 'SYNTHETIC_HISTORY_CONTEXT_REQUIRED', 'Synthetic history may only enter through the explicit sandbox scenario importer', 403);
    else this.d.human(actor, ['owner', 'operator']);
  }
  revision(type, input, customerId) {
    const previous = this.s.all(type).filter(item => item.customerId === customerId).sort((a, b) => b.revision - a.revision)[0];
    if (!previous) assert(input.revision === 1 && !input.previousRevisionId, 'REVISION_CHAIN_INVALID', 'The first engineering document revision must be one without a predecessor', 409);
    else assert(input.previousRevisionId === previous.id && input.revision === previous.revision + 1, 'REVISION_CHAIN_INVALID', 'A new engineering revision must point to the latest preceding revision', 409, { previousRevisionId: previous.id, nextRevision: previous.revision + 1 });
    return previous ? { previousRevisionId: previous.id, previousDigest: digest(previous) } : { previousRevisionId: null, previousDigest: null };
  }
  assertLatest(type, record) {
    const newer = this.s.all(type).find(item => item.customerId === record.customerId && item.revision > record.revision);
    assert(!newer, 'DOCUMENT_REVISION_SUPERSEDED', 'A newer engineering revision exists; use the latest document for a new commitment', 409, { type, id: record.id, latestId: newer?.id });
  }
  assertPointCurrent(pointPlan) { this.assertLatest('pointPlan', pointPlan); this.checkSnapshots(pointPlan.referenceSnapshots); }
  assertDesignCurrent(design) {
    this.assertLatest('design', design); this.checkSnapshots(design.referenceSnapshots);
    this.assertPointCurrent(this.get('pointPlan', design.pointPlanId));
    this.d.assertSolutionCurrent(this.get('solution', design.solutionId));
  }
  assertConstructionCurrent(construction) {
    this.assertLatest('construction', construction); this.checkSnapshots(construction.referenceSnapshots);
    this.assertDesignCurrent(this.get('design', construction.designId));
  }
  assertContractCurrent(contract) {
    this.checkSnapshots(contract.referenceSnapshots);
    this.assertConstructionCurrent(this.get('construction', contract.constructionId));
    const quote = this.get('quote', contract.quoteId);
    assert(quote.commitmentDigest === contract.quoteDigest, 'CONTRACT_QUOTE_CHANGED', 'Contract quote differs from the frozen commitment', 409);
    this.d.future(quote.validUntil, 'QUOTE_EXPIRED');
    this.d.assertSolutionCurrent(this.get('solution', quote.solutionId));
    return quote;
  }
  proposeLead(input, actor, supportingRecord) {
    const lead = this.get('lead', input.leadId);
    assert(lead.version === input.expectedVersion, 'VERSION_CONFLICT', 'Lead changed after the enrichment proposal was prepared', 409, { expectedVersion: input.expectedVersion, actualVersion: lead.version });
    validate(LEAD_PATCH_SCHEMA, input.patch, '$.patch');
    assert(Object.keys(input.patch).length > 0, 'EMPTY_LEAD_PATCH', 'A lead enrichment must contain at least one proposed field');
    const proposalId = input.id ?? `lead-proposal-${digest({ leadId: lead.id, version: lead.version, patch: input.patch, supportingRecord, actor: actor.id }).slice(0, 40)}`;
    return this.d.create('leadEnrichment', { id: proposalId }, { leadId: lead.id, storeId: lead.storeId, baseVersion: lead.version, proposedPatch: clone(input.patch), source: 'model-proposal', evidence: input.evidence ? this.d.evidence(input.evidence, { actor }) : null, supportingRecord: supportingRecord ?? this.snapshot('lead', lead.id), confirmationQuestions: input.confirmationQuestions ?? [], status: 'pending-human-confirmation', customerFactsApplied: false, consentGranted: false, proposedBy: actor.id, externallyVerified: false });
  }
  execute(operation, input, actor) {
    if (!operation.startsWith('lead.') && !DEPTH_ENTITY_TYPES.some(type => operation.startsWith(`${type}.`))) return undefined;
    switch (operation) {
      case 'lead.enrich': {
        const lead = this.get('lead', input.leadId);
        assert(lead.version === input.expectedVersion, 'VERSION_CONFLICT', 'Lead changed since it was read', 409, { expectedVersion: input.expectedVersion, actualVersion: lead.version });
        assert(Object.keys(input.patch).length > 0, 'EMPTY_LEAD_PATCH', 'A lead enrichment must contain at least one field');
        if (input.source === 'model-proposal') return this.proposeLead(input, actor);
        this.source(input.source, actor);
        const evidence = this.d.evidence(input.evidence, { actor });
        const next = { ...lead, ...clone(input.patch) };
        const history = [...(lead.enrichmentHistory ?? []), { beforeVersion: lead.version, source: input.source, evidence, fields: Object.keys(input.patch), previousValues: Object.fromEntries(Object.keys(input.patch).filter(key => lead[key] !== undefined).map(key => [key, clone(lead[key])])), newValues: clone(input.patch), recordedBy: actor.id, recordedAt: this.d.now(), customerConfirmationPerformed: !this.d.syntheticHistory }];
        assert(history.length <= 200, 'LEAD_HISTORY_LIMIT', 'Create a separately governed archive before extending a lead beyond two hundred enrichments', 409);
        const qualificationInvalidated = ['budgetCents', 'renovationStage', 'intent', 'needs'].some(key => Object.hasOwn(input.patch, key));
        return this.s.save('lead', lead.id, { ...next, enrichmentHistory: history, completeness: leadCompleteness(next), ...(qualificationInvalidated ? { status: 'needs-information', qualification: null } : {}) }, { expectedVersion: input.expectedVersion });
      }
      case 'customer.upsert': {
        const lead = this.get('lead', input.leadId);
        this.d.consent(lead, 'consultation'); this.source(input.source, actor);
        const previous = this.s.get('customer', input.id, false);
        if (previous) {
          assert(input.expectedVersion !== undefined, 'VERSION_REQUIRED', 'Existing customer dossier update requires expectedVersion', 409);
          assert(previous.leadId === lead.id && previous.storeId === lead.storeId, 'CUSTOMER_REPARENT_BLOCKED', 'A customer dossier cannot be moved to another lead or store', 403);
        } else {
          assert(input.expectedVersion === undefined, 'VERSION_CONFLICT', 'A new customer dossier has no existing version', 409);
          assert(!this.s.all('customer').some(item => item.leadId === lead.id), 'CUSTOMER_ALREADY_EXISTS', 'This lead already has a customer dossier; update its version', 409);
        }
        assert(Date.parse(input.communication.lastConfirmedAt) <= Date.parse(this.d.now()) + 60000, 'FUTURE_CUSTOMER_CONFIRMATION', 'Customer communication cannot be confirmed in the future');
        const history = [...(previous?.revisionHistory ?? []), ...(previous ? [{ version: previous.version, digest: digest(previous), source: previous.source, evidence: previous.evidence, content: fields(previous, 'revisionHistory', 'tenantId', 'workspaceId', 'dataMode', 'createdAt', 'updatedAt', 'type') }] : [])];
        assert(history.length <= 100, 'CUSTOMER_HISTORY_LIMIT', 'Create a separately governed archive before extending a dossier beyond one hundred revisions', 409);
        return this.s.save('customer', input.id, { ...fields(input, 'expectedVersion', 'evidence'), storeId: lead.storeId, evidence: this.d.evidence(input.evidence, { actor }), revisionHistory: history, leadVersionAtRecord: lead.version, identityPolicy: 'alias-and-opaque-references-only', externallyVerified: false }, { expectedVersion: input.expectedVersion });
      }
      case 'pointPlan.record': {
        const customer = this.get('customer', input.customerId), survey = this.get('survey', input.surveyId);
        assert(customer.leadId === survey.leadId, 'CUSTOMER_SURVEY_MISMATCH', 'Customer dossier and survey must refer to the same lead', 403);
        const roomMap = new Map(survey.rooms.map(room => [room.id, room]));
        assert(new Set(input.rooms.map(room => room.roomId)).size === input.rooms.length && input.rooms.every(room => roomMap.has(room.roomId)), 'POINT_ROOM_INVALID', 'Point-plan rooms must be unique surveyed rooms');
        const dimensions = new Map(input.rooms.map(room => [room.roomId, room]));
        assert(new Set(input.points.map(point => point.id)).size === input.points.length, 'DUPLICATE_POINT_ID', 'Point IDs must be unique');
        const skuIds = new Set();
        for (const point of input.points) {
          const room = dimensions.get(point.roomId);
          assert(room && point.xMm <= room.widthMm && point.yMm <= room.lengthMm, 'POINT_OUTSIDE_ROOM', 'Point coordinates must stay inside the declared room dimensions');
          if (point.skuId) { const sku = this.get('sku', point.skuId); assert(sku.active, 'SKU_INACTIVE', 'A point plan cannot use an inactive SKU'); skuIds.add(sku.id); }
          if (point.circuitId) assert(roomMap.get(point.roomId).circuits.some(circuit => circuit.id === point.circuitId), 'UNKNOWN_CIRCUIT', 'Point circuit must be present in the surveyed room');
        }
        return this.d.create('pointPlan', input, { ...input, ...this.revision('pointPlan', input, customer.id), customerId: customer.id, leadId: customer.leadId, storeId: customer.storeId, referenceSnapshots: [this.snapshot('customer', customer.id), this.snapshot('survey', survey.id), ...[...skuIds].map(id => this.snapshot('sku', id))], evidence: this.d.evidence(input.evidence, { actor }), diagramUnits: 'millimetres', drawingBasis: 'recorded-layout-plan', physicallyMeasuredByRuntime: false, constructionAuthorized: false, externallyVerified: false });
      }
      case 'design.record': {
        const customer = this.get('customer', input.customerId), solution = this.get('solution', input.solutionId), pointPlan = this.get('pointPlan', input.pointPlanId);
        assert(customer.leadId === solution.leadId && customer.id === pointPlan.customerId && solution.surveyId === pointPlan.surveyId, 'DESIGN_REFERENCE_MISMATCH', 'Customer, solution and point plan must describe the same surveyed home', 403);
        this.assertPointCurrent(pointPlan); this.d.assertSolutionCurrent(solution);
        const sceneIds = new Set(solution.scenes.map(scene => scene.id));
        assert(input.sceneNotes.length === sceneIds.size && new Set(input.sceneNotes.map(note => note.sceneId)).size === sceneIds.size && input.sceneNotes.every(note => sceneIds.has(note.sceneId)), 'DESIGN_SCENE_COVERAGE', 'Design notes must cover every validated scene exactly once');
        const allowedPairs = new Set(solution.bom.map(row => `${row.roomId}:${row.skuId}`));
        assert(pointPlan.points.filter(point => point.skuId).every(point => allowedPairs.has(`${point.roomId}:${point.skuId}`)), 'POINT_SKU_OUTSIDE_BOM', 'Every device point must belong to the solution BOM in that room');
        assert(pointPlan.points.every(point => point.skuId || ['network', 'outlet'].includes(point.kind)), 'DESIGN_POINT_SKU_REQUIRED', 'A validated design needs an exact SKU for each device point; network/outlet preparation points may remain unassigned');
        const plannedQuantities = new Map();
        for (const point of pointPlan.points.filter(point => point.skuId)) { const key = `${point.roomId}:${point.skuId}`; plannedQuantities.set(key, (plannedQuantities.get(key) ?? 0) + 1); }
        assert(plannedQuantities.size === solution.bom.length && solution.bom.every(row => plannedQuantities.get(`${row.roomId}:${row.skuId}`) === row.quantity), 'DESIGN_POINT_BOM_MISMATCH', 'A validated design must locate every BOM device exactly once in its surveyed room', 409);
        return this.d.create('design', input, { ...input, ...this.revision('design', input, customer.id), leadId: customer.leadId, storeId: customer.storeId, referenceSnapshots: [this.snapshot('customer', customer.id), this.snapshot('solution', solution.id), this.snapshot('pointPlan', pointPlan.id)], evidence: this.d.evidence(input.evidence, { actor }), status: 'draft-local-validated', customerApproved: false, physicalFeasibilityVerified: false, externallyVerified: false });
      }
      case 'construction.record': {
        const design = this.get('design', input.designId), solution = this.get('solution', design.solutionId);
        this.assertDesignCurrent(design);
        const expected = ['procurement', 'installation', 'commissioning', 'acceptance'];
        assert(input.milestones.every((row, index) => row.phase === expected[index]), 'MILESTONE_ORDER', 'Construction milestones must follow procurement, installation, commissioning and acceptance');
        for (const [index, row] of input.milestones.entries()) {
          assert(EMPLOYEES.includes(row.ownerRole), 'UNKNOWN_EMPLOYEE', 'Construction milestone owner is not registered'); this.d.future(row.dueAt);
          if (index) assert(Date.parse(row.dueAt) >= Date.parse(input.milestones[index - 1].dueAt), 'MILESTONE_DATE_ORDER', 'Construction milestone deadlines must be chronological');
        }
        for (const check of input.qualityChecks) assert(EMPLOYEES.includes(check.responsibleRole), 'UNKNOWN_EMPLOYEE', 'Construction quality-check owner is not registered');
        const required = new Map(); for (const row of solution.bom) required.set(row.skuId, (required.get(row.skuId) ?? 0) + row.quantity);
        assert(input.materials.length === required.size && new Set(input.materials.map(row => row.skuId)).size === required.size && input.materials.every(row => required.get(row.skuId) === row.quantity), 'CONSTRUCTION_BOM_MISMATCH', 'Construction materials must exactly match the validated solution quantities');
        return this.d.create('construction', input, { ...input, ...this.revision('construction', input, design.customerId), customerId: design.customerId, leadId: design.leadId, storeId: design.storeId, pointPlanId: design.pointPlanId, solutionId: solution.id, referenceSnapshots: [this.snapshot('design', design.id)], evidence: this.d.evidence(input.evidence, { actor }), status: 'planned-local', fieldWorkPerformed: false, externallyVerified: false });
      }
      case 'contract.create': {
        const customer = this.get('customer', input.customerId), quote = this.get('quote', input.quoteId), design = this.get('design', input.designId), construction = this.get('construction', input.constructionId);
        assert(customer.id === design.customerId && design.id === construction.designId && customer.leadId === quote.leadId && design.solutionId === quote.solutionId, 'CONTRACT_REFERENCE_MISMATCH', 'Contract customer, quote, design and construction documents must agree', 403);
        this.assertConstructionCurrent(construction); this.d.future(quote.validUntil, 'QUOTE_EXPIRED');
        assert(!['rejected'].includes(quote.status) && quote.policyViolations.length === 0, 'QUOTE_POLICY_BLOCKED', 'Contract drafts require a quote within all financial hard limits', 403);
        let sum = 0; for (const row of input.paymentSchedule) { sum += row.amountCents; assert(Number.isSafeInteger(sum), 'MONEY_OVERFLOW', 'Contract payment schedule exceeds safe integer cents'); }
        assert(sum === quote.totalCents, 'CONTRACT_PAYMENT_TOTAL_MISMATCH', 'Contract payment schedule must equal the frozen quote total');
        const commitment = { ...fields(input), leadId: customer.leadId, storeId: customer.storeId, totalCents: quote.totalCents, currency: quote.currency, quoteDigest: quote.commitmentDigest, referenceSnapshots: [this.snapshot('customer', customer.id), this.snapshot('design', design.id), this.snapshot('construction', construction.id)], financialCommitmentMade: false, actualCashMovement: false };
        return this.d.create('contract', input, { ...commitment, commitmentDigest: digest(commitment), status: 'draft', humanReviewPerformed: false, externallySigned: false });
      }
      case 'contract.request_approval': {
        const contract = this.get('contract', input.contractId), quote = this.assertContractCurrent(contract);
        assert(contract.status === 'draft', 'CONTRACT_STATE_CONFLICT', 'Only a draft contract can request approval', 409);
        assert(quote.status === 'approved' && this.d.approvalStatus(this.get('approval', quote.approvalId)) === 'approved', 'APPROVED_QUOTE_REQUIRED', 'Contract approval requires current separate quote approval', 403);
        assert(Date.parse(input.expiresAt) <= Date.parse(quote.validUntil), 'APPROVAL_AFTER_QUOTE_EXPIRY', 'Contract approval cannot outlive the quote');
        const approval = this.d.requestApproval('contract', contract.id, contract.commitmentDigest, input, { totalCents: contract.totalCents, quoteId: contract.quoteId, designId: contract.designId, constructionId: contract.constructionId });
        this.s.mutate('contract', contract.id, { status: 'awaiting-approval', approvalId: approval.id });
        return approval;
      }
      case 'contract.record_signing': {
        this.d.human(actor, ['owner', 'operator']);
        const contract = this.get('contract', input.contractId), quote = this.assertContractCurrent(contract);
        assert(contract.status === 'approved', 'APPROVED_CONTRACT_REQUIRED', 'Signing evidence requires a human-approved contract', 403);
        const approval = this.get('approval', contract.approvalId);
        assert(this.d.approvalStatus(approval) === 'approved' && approval.contentDigest === contract.commitmentDigest && quote.status === 'approved' && this.d.approvalStatus(this.get('approval', quote.approvalId)) === 'approved', 'APPROVAL_INVALID', 'Contract or quote approval is expired or changed', 403);
        return this.s.mutate('contract', contract.id, { status: 'signed-local-record', signingEvidence: this.d.evidence(input.evidence, { sources: ['customer'], actor, physical: true }), signedRecordedAt: this.d.now(), signingBasis: this.d.syntheticHistory ? 'synthetic-history-import' : 'human-supplied-customer-evidence', humanSigningRecorded: !this.d.syntheticHistory, externallySigned: false, financialCommitmentMade: false, actualCashMovement: false });
      }
      case 'business.record': {
        this.d.human(actor, ['owner', 'operator']); this.get('store', input.storeId);
        assert(Date.parse(input.occurredAt) <= Date.parse(this.d.now()) + 60000, 'FUTURE_BUSINESS_OBSERVATION', 'An observed operating record cannot be dated in the future');
        if (['channel-cost-observation', 'receivable-schedule', 'payment-observation', 'operating-expense-observation'].includes(input.kind)) assert(input.amountCents !== undefined, 'BUSINESS_AMOUNT_REQUIRED', 'Monetary observations need integer cents');
        if (['inventory-observation', 'staff-capacity'].includes(input.kind)) assert(input.quantity !== undefined, 'BUSINESS_QUANTITY_REQUIRED', 'Inventory and capacity observations need a quantity');
        for (const reference of input.objectRefs) {
          assert(ENTITY_TYPES.includes(reference.type), 'UNKNOWN_ENTITY_TYPE', 'Unknown operating reference type');
          const record = this.get(reference.type, reference.id);
          const storeId = reference.type === 'store' ? record.id : record.storeId ?? (record.leadId ? this.get('lead', record.leadId).storeId : null);
          assert(!storeId || storeId === input.storeId, 'STORE_SCOPE_MISMATCH', 'Operating references cannot reach another store', 403);
        }
        return this.d.create('business', input, { ...input, referenceSnapshots: input.objectRefs.map(ref => this.snapshot(ref.type, ref.id)), evidence: this.d.evidence(input.evidence, { actor }), financialClassification: 'observation-or-schedule-only', actualCashMovement: false, financialExecutionPerformed: false, externalPaymentExecuted: false, externalReceiptVerified: false, externallyVerified: false });
      }
      default: return undefined;
    }
  }
  decideContract(approval, target, input, actor) {
    assert(target.commitmentDigest === approval.contentDigest, 'APPROVAL_TARGET_CHANGED', 'Contract changed after review was requested', 409);
    if (input.decision === 'approved') {
      const quote = this.assertContractCurrent(target);
      assert(quote.status === 'approved' && this.d.approvalStatus(this.get('approval', quote.approvalId)) === 'approved', 'APPROVED_QUOTE_REQUIRED', 'Contract decision requires a current quote approval', 403);
    }
    return this.s.mutate('contract', target.id, { status: input.decision, approvalBasis: this.d.syntheticHistory ? 'synthetic-history-import' : 'authenticated-human-session', humanReviewPerformed: !this.d.syntheticHistory, financialCommitmentMade: false, actualCashMovement: false, decidedBy: actor.id });
  }
}
