import { assert, digest, clone } from './errors.mjs';
import { ENTITY_TYPES, OPERATION_BY_NAME } from './catalogue.mjs';
import { BusinessDepth, leadCompleteness } from './depth-domain.mjs';

const money = value => { assert(Number.isSafeInteger(value) && value >= 0, 'MONEY_OVERFLOW', 'Money must stay within safe nonnegative integer cents'); return value; };
const safetyCategories = new Set(['door-lock', 'camera', 'electrical', 'fire-safety']);
const without = (input, ...keys) => Object.fromEntries(Object.entries(input).filter(([key]) => !['idempotencyKey', ...keys].includes(key)));

export class BusinessDomain {
  constructor(storage, now) { this.s = storage; this.now = now; this.depth = new BusinessDepth(this); this.syntheticHistory = null; }
  evidence(input, { sources, actor, physical = false } = {}) {
    assert(Date.parse(input.observedAt) <= Date.parse(this.now()) + 60000, 'FUTURE_EVIDENCE', 'Evidence cannot be observed in the future');
    assert(this.s.dataMode === 'sandbox' || input.source !== 'synthetic', 'SYNTHETIC_EVIDENCE_IN_LIVE', 'Live records cannot use synthetic evidence');
    if (sources) assert(sources.includes(input.source) || (this.s.dataMode === 'sandbox' && input.source === 'synthetic'), 'WRONG_EVIDENCE_SOURCE', `Evidence source must be ${sources.join(' or ')}`);
    if (physical) this.human(actor, ['owner', 'operator']);
    return { ...clone(input), verification: input.source === 'synthetic' ? 'synthetic-unverified' : 'human-supplied-unverified', externallyVerified: false, ...(this.syntheticHistory ? { origin: 'synthetic-history-import', humanEvidenceProvided: false } : {}), recordedBy: actor?.id ?? 'unattributed' };
  }
  human(actor, roles = ['owner']) {
    if (this.syntheticHistory && this.s.dataMode === 'sandbox') return;
    assert(roles.includes(actor?.role) && actor?.humanConfirmed === true && ['cli', 'http', ...(this.s.dataMode === 'sandbox' ? ['test'] : [])].includes(actor?.channel), 'HUMAN_REVIEW_REQUIRED', 'This action requires an authenticated human session and explicit confirmation', 403);
  }
  future(value, code = 'INVALID_DEADLINE') { assert(Date.parse(value) > Date.parse(this.now()), code, 'Deadline must be in the future'); }
  consent(lead, purpose) { assert(lead.consent.status === 'granted' && lead.consent.purposes.includes(purpose), 'CONSENT_REQUIRED', `Customer consent for ${purpose} is required`, 403); }
  create(type, input, fields = input) { return this.s.save(type, input.id, without(fields), { create: true }); }
  get(type, id) { return this.s.get(type, id); }
  safe(entity) {
    const result = clone(entity);
    if (result.type === 'lead') result.completeness = leadCompleteness(result);
    delete result.leaseTokenHash;
    if (result.context) delete result.context.leaseTokenHash;
    return result;
  }
  read(operation, input, workflows) {
    const deeper = this.depth.read(operation, input);
    if (deeper !== undefined) return deeper;
    if (operation === 'entity.get') { assert(ENTITY_TYPES.includes(input.type), 'UNKNOWN_ENTITY_TYPE', 'Unknown business object type'); return this.safe(this.get(input.type, input.id)); }
    if (operation === 'entity.list') { assert(ENTITY_TYPES.includes(input.type), 'UNKNOWN_ENTITY_TYPE', 'Unknown business object type'); return this.s.list(input.type, input).map(entity => this.safe(entity)); }
    if (operation === 'state.snapshot') return Object.fromEntries(ENTITY_TYPES.map(type => [type, { total: this.s.count(type), items: this.s.list(type, { limit: input.limit ?? 100 }).map(entity => this.safe(entity)) }]));
    if (operation === 'ledger.verify') return this.s.verify();
    if (operation === 'ledger.list') return this.s.events(input);
    if (operation === 'approval.list') return this.s.all('approval').filter(item => !input.status || this.approvalStatus(item) === input.status).slice(0, input.limit ?? 100).map(item => ({ ...this.safe(item), effectiveStatus: this.approvalStatus(item) }));
    if (operation === 'goal.report') return this.goalReport(input.goalId);
    if (operation === 'task.list') return this.s.all('task').filter(task => (!input.workflowId || task.workflowId === input.workflowId) && (!input.status || task.status === input.status)).slice(0, input.limit ?? 100).map(task => workflows.presentTask(task));
    if (operation === 'workflow.get') return workflows.presentWorkflow(input.workflowId);
    return undefined;
  }
  execute(operation, input, actor) {
    const descriptor = OPERATION_BY_NAME.get(operation);
    if (descriptor) this.s.recordFences(descriptor.fenceIds, operation.includes('request_') ? 'review' : 'pass');
    const deeper = this.depth.execute(operation, input, actor);
    if (deeper !== undefined) return deeper;
    switch (operation) {
      case 'store.upsert': {
        const old = this.s.get('store', input.id, false);
        if (old) assert(input.expectedVersion !== undefined, 'VERSION_REQUIRED', 'Existing store update requires expectedVersion', 409);
        if (old) assert(input.minMarginRatio >= old.minMarginRatio && input.maxDiscountRatio <= old.maxDiscountRatio, 'FENCE_LOOSENING_BLOCKED', 'Existing store financial thresholds may only be tightened', 403);
        if (old && (input.minMarginRatio !== old.minMarginRatio || input.maxDiscountRatio !== old.maxDiscountRatio)) this.human(actor);
        return this.s.save('store', input.id, without(input, 'expectedVersion'), { expectedVersion: input.expectedVersion });
      }
      case 'sku.upsert': {
        const old = this.s.get('sku', input.id, false);
        if (old) assert(input.expectedVersion !== undefined, 'VERSION_REQUIRED', 'Existing SKU update requires expectedVersion', 409);
        assert(input.priceCents >= input.costCents, 'SKU_NEGATIVE_MARGIN', 'Catalogue price cannot be below its recorded cost');
        assert(this.s.dataMode === 'sandbox' || input.installationRequirements, 'INSTALLATION_REQUIREMENTS_REQUIRED', 'Live SKUs need evidence-backed installation requirements; electrical assumptions cannot be guessed');
        if (input.installationRequirements) assert(input.installationRequirements.voltageMax >= input.installationRequirements.voltageMin, 'INVALID_VOLTAGE_RANGE', 'Manufacturer voltage range is invalid');
        const evidence = this.evidence(input.evidence, { sources: ['manufacturer'], actor });
        return this.s.save('sku', input.id, { ...without(input, 'expectedVersion', 'evidence'), active: input.active ?? true, evidence }, { expectedVersion: input.expectedVersion });
      }
      case 'compatibility.record': {
        assert(input.leftSkuId !== input.rightSkuId, 'INVALID_COMPATIBILITY_PAIR', 'Compatibility requires two distinct SKUs');
        const left = this.get('sku', input.leftSkuId), right = this.get('sku', input.rightSkuId);
        this.future(input.expiresAt, 'COMPATIBILITY_EXPIRED');
        return this.create('compatibility', input, { ...input, skuVersions: { [left.id]: left.version, [right.id]: right.version }, firmwareVersions: { [left.id]: left.firmwareVersion, [right.id]: right.firmwareVersion }, evidence: this.evidence(input.evidence, { sources: ['manufacturer'], actor }) });
      }
      case 'lead.create': {
        this.get('store', input.storeId);
        assert(input.alias || input.surname || input.contactRef || input.phoneRef || input.wechatRef || input.buildingRef || input.buildingName, 'LEAD_IDENTIFIER_REQUIRED', 'At least a surname/alias, opaque contact reference or building reference is needed; other facts may remain unknown');
        assert(!['model-proposal', 'synthetic-history'].includes(input.source) || (input.source === 'synthetic-history' && this.syntheticHistory), 'CUSTOMER_FACT_CONFIRMATION_REQUIRED', 'Model suggestions cannot enter as customer facts, and synthetic history requires the scenario importer', 403);
        const consent = clone(input.consent ?? { status: 'unknown', purposes: [] });
        if (consent.status === 'granted') {
          assert(consent.evidence, 'CONSENT_EVIDENCE_REQUIRED', 'Granted consent requires evidence');
          if (this.s.dataMode === 'live') this.human(actor, ['owner', 'operator']);
          consent.evidence = this.evidence(consent.evidence, { sources: ['customer'], actor });
          assert(consent.purposes.length > 0, 'CONSENT_PURPOSE_REQUIRED', 'Granted consent needs at least one purpose');
        } else assert(consent.purposes.length === 0, 'CONSENT_PURPOSE_CONFLICT', 'Unknown or denied consent cannot authorize a purpose');
        const record = { ...input, channel: input.channel ?? 'unknown', source: input.source ?? 'operator', evidence: input.evidence ? this.evidence(input.evidence, { actor }) : null, consent, status: 'new', enrichmentHistory: [], attribution: { channel: input.channel ?? 'unknown', campaignRef: input.campaignRef ?? null, model: 'first-recorded-touch' } };
        return this.create('lead', input, { ...record, completeness: leadCompleteness(record) });
      }
      case 'lead.authorize': {
        const lead = this.get('lead', input.leadId);
        if (this.s.dataMode === 'live') this.human(actor, ['owner', 'operator']);
        assert((input.status === 'granted' && input.purposes.length > 0) || (input.status === 'denied' && input.purposes.length === 0), 'CONSENT_PURPOSE_CONFLICT', 'Consent status and purposes conflict');
        return this.s.mutate('lead', lead.id, { consent: { status: input.status, purposes: input.purposes, evidence: this.evidence(input.evidence, { sources: ['customer'], actor }), recordedAt: this.now() } });
      }
      case 'experience.schedule': {
        const lead = this.get('lead', input.leadId);
        this.consent(lead, 'appointment');
        this.future(input.startsAt, 'APPOINTMENT_IN_PAST');
        let confirmationEvidence = null;
        if (input.status === 'customer-confirmed') {
          assert(input.confirmationEvidence, 'CUSTOMER_EVIDENCE_REQUIRED', 'A customer-confirmed booking requires customer evidence');
          confirmationEvidence = this.evidence(input.confirmationEvidence, { sources: ['customer'], actor, physical: true });
        }
        return this.create('experience', input, { ...input, status: input.status ?? 'proposed', confirmationEvidence, externalNotification: 'disabled', externalBookingVerified: false });
      }
      case 'survey.record': {
        const lead = this.get('lead', input.leadId);
        this.consent(lead, 'consultation');
        assert(new Set(input.rooms.map(room => room.id)).size === input.rooms.length, 'DUPLICATE_ROOM', 'Room IDs must be unique');
        for (const room of input.rooms) assert(new Set(room.circuits.map(circuit => circuit.id)).size === room.circuits.length, 'DUPLICATE_CIRCUIT', 'Circuit IDs must be unique within a room');
        return this.create('survey', input, { ...input, evidence: this.evidence(input.evidence, { sources: ['site', 'technician'], actor, physical: true }), stage: 'field-recorded', externallyVerified: false });
      }
      case 'solution.build': return this.buildSolution(input);
      case 'quote.create': return this.createQuote(input);
      case 'quote.request_approval': {
        const quote = this.get('quote', input.quoteId);
        assert(quote.status === 'draft', 'QUOTE_STATE_CONFLICT', 'Only a draft quote can request approval', 409);
        this.future(quote.validUntil, 'QUOTE_EXPIRED');
        assert(Date.parse(input.expiresAt) <= Date.parse(quote.validUntil), 'APPROVAL_AFTER_QUOTE_EXPIRY', 'Approval cannot outlive the quote');
        const approval = this.requestApproval('quote', quote.id, quote.commitmentDigest, input, { totalCents: quote.totalCents, grossMarginRatio: quote.grossMarginRatio, policyViolations: quote.policyViolations });
        this.s.mutate('quote', quote.id, { status: 'awaiting-approval', approvalId: approval.id });
        return approval;
      }
      case 'approval.decide': return this.decideApproval(input, actor);
      case 'project.create': {
        this.human(actor, ['owner', 'operator']);
        const quote = this.get('quote', input.quoteId);
        assert(quote.status === 'approved', 'APPROVED_QUOTE_REQUIRED', 'A project requires a human-approved quote', 403);
        this.future(quote.validUntil, 'QUOTE_EXPIRED');
        this.assertSolutionCurrent(this.get('solution', quote.solutionId));
        const approval = this.get('approval', quote.approvalId);
        assert(this.approvalStatus(approval) === 'approved' && approval.contentDigest === quote.commitmentDigest, 'APPROVAL_INVALID', 'Quote approval is expired, changed or not approved', 403);
        assert(!this.s.all('project').some(project => project.quoteId === quote.id), 'PROJECT_ALREADY_EXISTS', 'This quote already has a project', 409);
        const dossier = this.s.all('customer').find(customer => customer.leadId === quote.leadId);
        assert(!dossier || input.contractId, 'SIGNED_CONTRACT_REQUIRED', 'A dossier-backed project requires an approved contract and customer signing evidence', 403);
        let contract = null;
        if (input.contractId) {
          contract = this.get('contract', input.contractId);
          assert(contract.quoteId === quote.id && contract.status === 'signed-local-record', 'SIGNED_CONTRACT_REQUIRED', 'The project contract must be signed locally and match its quote', 403);
          this.depth.assertContractCurrent(contract);
        }
        this.future(input.dueAt);
        return this.create('project', input, { ...input, ...(contract ? { contractDigest: contract.commitmentDigest, constructionId: contract.constructionId, designId: contract.designId, customerId: contract.customerId } : {}), solutionId: quote.solutionId, leadId: quote.leadId, storeId: quote.storeId, status: 'contracted', milestone: 'contract', contractEvidence: this.evidence(input.contractEvidence, { sources: ['customer'], actor, physical: true }), quoteDigest: quote.commitmentDigest, localAcceptanceVerified: false, externalAcceptanceVerified: false });
      }
      case 'procurement.record': return this.recordProcurement(input, actor);
      case 'project.milestone': {
        const project = this.get('project', input.projectId);
        assert(project.milestone === 'procurement', 'MILESTONE_ORDER', 'Installation needs complete BOM procurement first', 409);
        assert(Object.values(input.safetyChecklist).every(value => value === true), 'INSTALLATION_SAFETY_INCOMPLETE', 'All installation safety checklist items must pass', 403);
        const evidence = this.evidence(input.evidence, { sources: ['site', 'technician'], actor, physical: true });
        return this.s.mutate('project', project.id, { milestone: 'installation', status: 'installed-recorded', installation: { ...without(input, 'projectId', 'milestone', 'evidence'), evidence, externalVerified: false } });
      }
      case 'commissioning.record': return this.recordCommissioning(input, actor);
      case 'acceptance.record': return this.recordAcceptance(input, actor);
      case 'aftercare.open': {
        const project = this.get('project', input.projectId);
        this.future(input.dueAt);
        const safety = ['safety', 'privacy'].includes(input.category);
        assert(!safety || ['critical', 'high'].includes(input.severity), 'SAFETY_ESCALATION_REQUIRED', 'Safety and privacy issues require high or critical severity');
        return this.create('aftercare', input, { ...input, storeId: project.storeId, leadId: project.leadId, status: 'open', requiresHumanSpecialist: safety, externallyResolved: false });
      }
      case 'aftercare.resolve': {
        const ticket = this.get('aftercare', input.ticketId);
        assert(ticket.status !== 'resolved', 'TICKET_ALREADY_RESOLVED', 'This ticket is already resolved', 409);
        const evidence = this.evidence(input.evidence, { sources: ['technician', 'customer'], actor, physical: true });
        this.future(input.followupAt);
        assert(input.customerConfirmed, 'CUSTOMER_CONFIRMATION_REQUIRED', 'A resolved ticket needs customer confirmation', 403);
        return this.s.mutate('aftercare', ticket.id, { status: 'resolved', resolution: input.resolution, evidence, customerConfirmed: true, followupAt: input.followupAt, resolvedAt: this.now(), operationalResolutionRecorded: !this.syntheticHistory, externallyResolved: false });
      }
      case 'content.create': {
        this.get('store', input.storeId);
        assert(input.piiFree === true, 'PII_REVIEW_REQUIRED', 'Content must declare a PII-free draft');
        for (const skuId of input.skuIds) this.get('sku', skuId);
        const claims = input.claims.map(claim => ({ text: claim.text, evidence: this.evidence(claim.evidence, { sources: ['manufacturer', 'site', 'customer'], actor }) }));
        assert(!/(?:100%兼容|百分之百兼容|所有设备.{0,5}互通|零故障|绝对安全|永久免费|guaranteed compatibility)/i.test(`${input.title}\n${input.body}`), 'UNSUPPORTED_MARKETING_CLAIM', 'Absolute compatibility, safety or warranty claims are prohibited');
        assert(!input.skuIds.length || claims.length > 0, 'CONTENT_CLAIMS_REQUIRED', 'Named devices need recorded factual claim evidence');
        return this.create('content', input, { ...input, claims, status: 'draft', externalPublicationStatus: 'disabled', externallyPublished: false });
      }
      case 'content.request_publication': {
        const content = this.get('content', input.contentId);
        assert(content.status === 'draft', 'CONTENT_STATE_CONFLICT', 'Only a draft can request publication', 409);
        const approval = this.requestApproval('content', content.id, digest({ title: content.title, body: content.body, channel: content.channel, claims: content.claims, skuIds: content.skuIds }), input, { title: content.title, channel: content.channel, connectorStatus: 'disabled' });
        this.s.mutate('content', content.id, { status: 'awaiting-approval', approvalId: approval.id, externalPublicationStatus: 'disabled' });
        return { ...approval, connectorStatus: 'disabled', publicationExecuted: false };
      }
      case 'content.publish': assert(false, 'CONNECTOR_DISABLED', 'External publishing is disabled; approval alone cannot create an external receipt', 409); break;
      case 'goal.create': {
        this.get('store', input.storeId);
        this.future(input.deadline);
        return this.create('goal', input, { ...input, status: 'active', authority: 'local-planning-only', externalActionsEnabled: false });
      }
      case 'goal.instruct': {
        this.human(actor);
        const goal = this.get('goal', input.goalId);
        assert(input.action !== 'resume' || goal.status === 'paused', 'GOAL_STATE_CONFLICT', 'Only a paused goal can resume', 409);
        return this.s.mutate('goal', goal.id, { status: input.action === 'pause' ? 'paused' : 'active', ...(input.target ? { target: input.target } : {}), lastInstruction: { action: input.action, text: input.instruction, receivedAt: this.now(), receivedBy: actor.id } });
      }
      default: return undefined;
    }
  }

  buildSolution(input) {
    const survey = this.get('survey', input.surveyId), lead = this.get('lead', survey.leadId);
    this.consent(lead, 'consultation');
    const rooms = new Set(survey.rooms.map(room => room.id));
    const uniqueRows = new Set();
    const circuitLoads = new Map();
    const skus = new Map();
    let costCents = 0, cataloguePriceCents = 0;
    for (const row of input.bom) {
      assert(rooms.has(row.roomId), 'UNKNOWN_ROOM', `BOM room ${row.roomId} is absent from the survey`);
      assert(!uniqueRows.has(`${row.roomId}:${row.skuId}`), 'DUPLICATE_BOM_ROW', 'Duplicate room/SKU rows must be combined');
      uniqueRows.add(`${row.roomId}:${row.skuId}`);
      const sku = this.get('sku', row.skuId);
      assert(sku.active, 'SKU_INACTIVE', `SKU ${sku.id} is inactive`);
      skus.set(sku.id, sku);
      const requirements = sku.installationRequirements;
      if (requirements) {
        assert(!requirements.requiresInternet || survey.network.internetAvailable, 'NETWORK_REQUIREMENT_UNMET', 'SKU requires an Internet connection absent from the survey');
        assert(!requirements.requiresWiredBackhaul || survey.network.wiredBackhaul, 'NETWORK_REQUIREMENT_UNMET', 'SKU requires wired backhaul absent from the survey');
        if (requirements.powerType === 'mains') {
          assert(row.circuitId, 'CIRCUIT_REQUIRED', 'A mains-powered BOM row requires a surveyed circuitId');
          const circuit = survey.rooms.find(room => room.id === row.roomId).circuits.find(item => item.id === row.circuitId);
          assert(circuit, 'UNKNOWN_CIRCUIT', 'BOM circuit is absent from the room survey');
          assert(!requirements.requiresNeutralWire || circuit.neutralWire, 'NEUTRAL_WIRE_REQUIRED', 'This SKU requires a neutral wire absent from the surveyed circuit');
          assert(circuit.voltage >= requirements.voltageMin && circuit.voltage <= requirements.voltageMax, 'VOLTAGE_REQUIREMENT_UNMET', 'Surveyed circuit voltage is outside the manufacturer range');
          const key = `${row.roomId}:${row.circuitId}`;
          const watts = (circuitLoads.get(key) ?? 0) + requirements.ratedWatts * row.quantity;
          assert(watts <= circuit.maxLoadWatts, 'CIRCUIT_OVERLOAD', 'BOM rated load exceeds the surveyed circuit limit');
          circuitLoads.set(key, watts);
        }
      }
      costCents = money(costCents + money(sku.costCents * row.quantity));
      cataloguePriceCents = money(cataloguePriceCents + money(sku.priceCents * row.quantity));
    }
    assert(new Set(input.scenes.map(scene => scene.id)).size === input.scenes.length, 'DUPLICATE_SCENE', 'Scene IDs must be unique');
    for (const scene of input.scenes) {
      assert(rooms.has(scene.roomId), 'UNKNOWN_ROOM', 'Scene room is absent from the survey');
      for (const skuId of scene.skuIds) assert(skus.has(skuId), 'SCENE_SKU_OUTSIDE_BOM', 'A scene uses a SKU absent from its BOM');
    }
    const compatibility = input.compatibilityIds.map(id => this.get('compatibility', id));
    const allCompatibility = this.s.all('compatibility');
    const checkedPairs = [];
    const skuIds = [...skus.keys()].sort();
    for (let i = 0; i < skuIds.length; i++) for (let j = i + 1; j < skuIds.length; j++) {
      const left = skus.get(skuIds[i]), right = skus.get(skuIds[j]);
      const contraryEvidence = allCompatibility.find(item => item.result === 'incompatible' && new Set([item.leftSkuId, item.rightSkuId]).has(left.id) && new Set([item.leftSkuId, item.rightSkuId]).has(right.id) && item.skuVersions[left.id] === left.version && item.skuVersions[right.id] === right.version && Date.parse(item.expiresAt) > Date.parse(this.now()));
      assert(!contraryEvidence, 'COMPATIBILITY_CONFLICT', 'Current incompatibility evidence blocks the pair even if an older compatible reference was supplied', 409);
      const record = compatibility.find(item => new Set([item.leftSkuId, item.rightSkuId]).has(left.id) && new Set([item.leftSkuId, item.rightSkuId]).has(right.id));
      assert(record, 'COMPATIBILITY_EVIDENCE_MISSING', `No exact compatibility record for ${left.id} / ${right.id}`, 409);
      assert(record.result === 'compatible', 'DEVICE_INCOMPATIBLE', `Recorded incompatibility for ${left.id} / ${right.id}`, 409);
      assert(record.skuVersions[left.id] === left.version && record.skuVersions[right.id] === right.version, 'COMPATIBILITY_STALE', 'SKU version changed; compatibility must be reverified', 409);
      this.future(record.expiresAt, 'COMPATIBILITY_EXPIRED');
      checkedPairs.push({ leftSkuId: left.id, rightSkuId: right.id, compatibilityId: record.id, conditions: record.conditions, externallyVerified: false });
    }
    assert(input.compatibilityIds.length === compatibility.length && new Set(input.compatibilityIds).size === input.compatibilityIds.length, 'DUPLICATE_COMPATIBILITY', 'Compatibility references must be unique');
    const containsHighRiskHardware = [...skus.values()].some(sku => safetyCategories.has(sku.category));
    return this.create('solution', input, { ...input, leadId: lead.id, storeId: lead.storeId, costCents, cataloguePriceCents, skuSnapshots: Object.fromEntries([...skus].map(([key, sku]) => [key, { version: sku.version, firmwareVersion: sku.firmwareVersion, costCents: sku.costCents, priceCents: sku.priceCents, category: sku.category }])), compatibilityChecks: checkedPairs, electricalLoadChecks: Object.fromEntries(circuitLoads), status: 'validated-local', physicalFeasibilityVerified: false, containsHighRiskHardware, exclusions: input.exclusions ?? [], safetyRequirement: containsHighRiskHardware ? 'qualified-professional-and-human-approval' : 'onsite-installation-and-customer-evidence' });
  }
  createQuote(input) {
    const solution = this.get('solution', input.solutionId);
    this.assertSolutionCurrent(solution);
    this.future(input.validUntil, 'QUOTE_EXPIRED');
    const store = this.get('store', solution.storeId);
    const subtotalCents = money(solution.cataloguePriceCents + input.laborPriceCents);
    const costCents = money(solution.costCents + input.laborCostCents);
    assert(input.discountCents < subtotalCents, 'INVALID_DISCOUNT', 'Discount must be smaller than subtotal');
    const totalCents = money(subtotalCents - input.discountCents);
    const grossProfitCents = totalCents - costCents;
    const grossMarginRatio = grossProfitCents / totalCents;
    const discountRatio = input.discountCents / subtotalCents;
    const policyViolations = [];
    if (grossMarginRatio < store.minMarginRatio) policyViolations.push('below-minimum-gross-margin');
    if (discountRatio > store.maxDiscountRatio) policyViolations.push('above-maximum-discount');
    if (grossProfitCents < 0) policyViolations.push('negative-gross-profit');
    const commitment = { ...without(input), storeId: store.id, leadId: solution.leadId, subtotalCents, costCents, totalCents, grossProfitCents, grossMarginRatio, discountRatio, policyViolations, solutionDigest: digest(solution), currency: 'CNY' };
    return this.create('quote', input, { ...commitment, commitmentDigest: digest(commitment), status: 'draft', externalQuoteDelivered: false, financialCommitmentMade: false });
  }
  assertSolutionCurrent(solution) {
    for (const [skuId, snapshot] of Object.entries(solution.skuSnapshots)) {
      const sku = this.get('sku', skuId);
      assert(sku.active && sku.version === snapshot.version, 'SOLUTION_SKU_STALE', 'A solution SKU changed or became inactive; rebuild the solution before committing a quote', 409);
    }
    for (const check of solution.compatibilityChecks) this.future(this.get('compatibility', check.compatibilityId).expiresAt, 'COMPATIBILITY_EXPIRED');
    const contrary = this.s.all('compatibility').some(item => item.result === 'incompatible' && Object.hasOwn(solution.skuSnapshots, item.leftSkuId) && Object.hasOwn(solution.skuSnapshots, item.rightSkuId) && item.skuVersions[item.leftSkuId] === solution.skuSnapshots[item.leftSkuId].version && item.skuVersions[item.rightSkuId] === solution.skuSnapshots[item.rightSkuId].version && Date.parse(item.expiresAt) > Date.parse(this.now()));
    assert(!contrary, 'COMPATIBILITY_CONFLICT', 'Current incompatibility evidence blocks this solution', 409);
  }
  requestApproval(targetType, targetId, contentDigest, input, summary) {
    this.future(input.expiresAt, 'APPROVAL_EXPIRED');
    assert(Date.parse(input.expiresAt) <= Date.parse(this.now()) + 7 * 86400000, 'APPROVAL_LIFETIME_TOO_LONG', 'Human approval expires within seven days');
    const id = `approval-${targetType}-${digest({ targetId, contentDigest }).slice(0, 32)}`;
    return this.s.save('approval', id, { targetType, targetId, contentDigest, status: 'pending', reason: input.reason, expiresAt: input.expiresAt, summary, requestedAt: this.now(), externallyExecuted: false }, { create: true });
  }
  approvalStatus(approval) { return ['pending', 'approved'].includes(approval.status) && Date.parse(approval.expiresAt) <= Date.parse(this.now()) ? 'expired' : approval.status; }
  decideApproval(input, actor) {
    this.human(actor);
    const approval = this.get('approval', input.approvalId);
    assert(approval.status === 'pending', 'APPROVAL_ALREADY_DECIDED', 'Approval is already decided', 409);
    this.future(approval.expiresAt, 'APPROVAL_EXPIRED');
    assert(approval.contentDigest === input.contentDigest, 'APPROVAL_CONTENT_MISMATCH', 'Approval decision does not match the proposed content', 409);
    const target = this.get(approval.targetType, approval.targetId);
    if (approval.targetType === 'quote') {
      assert(target.commitmentDigest === approval.contentDigest, 'APPROVAL_TARGET_CHANGED', 'The quote content changed after review was requested', 409);
      this.future(target.validUntil, 'QUOTE_EXPIRED');
      if (input.decision === 'approved') this.assertSolutionCurrent(this.get('solution', target.solutionId));
      assert(input.decision !== 'approved' || !target.policyViolations.includes('negative-gross-profit'), 'NEGATIVE_MARGIN_BLOCKED', 'A quote with negative gross profit cannot be approved', 403);
      assert(input.decision !== 'approved' || target.policyViolations.length === 0, 'QUOTE_POLICY_BLOCKED', 'Gross margin and discount hard limits cannot be overridden by a human approval', 403, { violations: target.policyViolations });
      this.s.mutate('quote', target.id, { status: input.decision, financialCommitmentMade: false, humanApprovedAt: input.decision === 'approved' && !this.syntheticHistory ? this.now() : null, approvalBasis: this.syntheticHistory ? 'synthetic-history-import' : 'authenticated-human-session', humanReviewPerformed: !this.syntheticHistory });
    } else if (approval.targetType === 'contract') {
      this.depth.decideContract(approval, target, input, actor);
    } else {
      const currentDigest = digest({ title: target.title, body: target.body, channel: target.channel, claims: target.claims, skuIds: target.skuIds });
      assert(currentDigest === approval.contentDigest, 'APPROVAL_TARGET_CHANGED', 'Content changed after review was requested', 409);
      this.s.mutate('content', target.id, { status: input.decision === 'approved' ? 'approved-pending-connector' : 'rejected', externalPublicationStatus: 'disabled', externallyPublished: false });
    }
    return this.s.mutate('approval', approval.id, { status: input.decision, decision: { result: input.decision, reason: input.reason, decidedAt: this.now(), decidedBy: actor.id, channel: actor.channel, contentDigest: input.contentDigest, basis: this.syntheticHistory ? 'synthetic-history-import' : 'authenticated-human-session', humanReviewPerformed: !this.syntheticHistory }, externallyExecuted: false });
  }
  recordProcurement(input, actor) {
    const project = this.get('project', input.projectId);
    assert(['contract', 'procurement'].includes(project.milestone), 'MILESTONE_ORDER', 'Procurement records cannot modify an installed project', 409);
    const solution = this.get('solution', project.solutionId);
    const required = new Map();
    for (const row of solution.bom) required.set(row.skuId, (required.get(row.skuId) ?? 0) + row.quantity);
    const evidence = this.evidence(input.evidence, { sources: ['invoice', 'site'], actor, physical: true });
    assert(new Set(input.items.map(item => item.skuId)).size === input.items.length, 'DUPLICATE_PROCUREMENT_ITEM', 'SKU rows must be unique');
    const previous = this.s.all('procurement').filter(record => record.projectId === project.id);
    const received = new Map();
    const serials = new Set(previous.flatMap(record => record.items.flatMap(item => item.serialRefs)));
    for (const record of previous) for (const item of record.items) received.set(item.skuId, (received.get(item.skuId) ?? 0) + item.quantity);
    for (const item of input.items) {
      assert(required.has(item.skuId), 'PROCUREMENT_OUTSIDE_BOM', 'Procurement contains a SKU outside the approved BOM');
      assert(item.serialRefs.length === 0 || item.serialRefs.length === item.quantity, 'SERIAL_QUANTITY_MISMATCH', 'Serial references must be absent or match received quantity');
      for (const serial of item.serialRefs) { assert(!serials.has(serial), 'DUPLICATE_DEVICE_SERIAL', 'A device serial is already recorded'); serials.add(serial); }
      const quantity = (received.get(item.skuId) ?? 0) + item.quantity;
      assert(quantity <= required.get(item.skuId), 'PROCUREMENT_EXCEEDS_BOM', 'Received quantity exceeds the approved BOM');
      received.set(item.skuId, quantity);
    }
    const record = this.create('procurement', input, { ...input, evidence, externalPurchaseExecuted: false, receivedLocally: true });
    const complete = [...required].every(([skuId, quantity]) => received.get(skuId) === quantity);
    this.s.mutate('project', project.id, { milestone: complete ? 'procurement' : 'contract', status: complete ? 'materials-recorded' : 'awaiting-materials', procurementComplete: complete });
    return record;
  }
  recordCommissioning(input, actor) {
    const project = this.get('project', input.projectId);
    assert(['installation', 'commissioning'].includes(project.milestone), 'MILESTONE_ORDER', 'Commissioning requires installation evidence', 409);
    const solution = this.get('solution', project.solutionId);
    const sceneIds = solution.scenes.map(scene => scene.id);
    assert(new Set(input.results.map(result => result.sceneId)).size === input.results.length, 'DUPLICATE_SCENE_RESULT', 'Each scene has exactly one result');
    assert(input.results.length === sceneIds.length && input.results.every(result => sceneIds.includes(result.sceneId)), 'INCOMPLETE_COMMISSIONING', 'Every approved scene must have a commissioning result');
    const evidence = this.evidence(input.evidence, { sources: ['site', 'technician'], actor, physical: true });
    const passed = input.results.every(result => result.passed);
    const record = this.create('commissioning', input, { ...input, evidence, allPassed: passed, externallyVerified: false });
    this.s.mutate('project', project.id, { milestone: passed ? 'commissioning' : 'installation', status: passed ? 'commissioned-recorded' : 'commissioning-failed', commissioningId: record.id });
    return record;
  }
  recordAcceptance(input, actor) {
    const project = this.get('project', input.projectId);
    assert(project.milestone === 'commissioning', 'MILESTONE_ORDER', 'Customer acceptance requires successful commissioning', 409);
    const evidence = this.evidence(input.evidence, { sources: ['customer'], actor, physical: true });
    const accepted = input.customerAccepted && input.trainingDelivered && input.credentialsTransferred && input.outstandingIssues.length === 0;
    const record = this.create('acceptance', input, { ...input, evidence, acceptedLocally: accepted, externallyVerified: false });
    this.s.mutate('project', project.id, { milestone: accepted ? 'acceptance' : 'commissioning', status: accepted ? 'accepted-local-record' : 'acceptance-pending', acceptanceId: record.id, localAcceptanceVerified: accepted, operationalAcceptanceRecorded: accepted && !this.syntheticHistory, externalAcceptanceVerified: false });
    return record;
  }
  goalReport(goalId) {
    const goal = this.get('goal', goalId);
    const operational = item => item.dataOrigin !== 'synthetic-history-import';
    const leads = this.s.all('lead').filter(item => item.storeId === goal.storeId && (operational(item) || item.operationalAssessmentAt));
    const projects = this.s.all('project').filter(item => item.storeId === goal.storeId && (operational(item) || item.operationalAcceptanceRecorded));
    const leadIds = new Set(leads.map(item => item.id));
    const metrics = {
      'qualified-leads': leads.filter(item => item.status === 'qualified').length,
      'experience-plans': this.s.all('experience').filter(item => operational(item) && (leadIds.has(item.leadId) || this.get('lead', item.leadId).storeId === goal.storeId)).length,
      'accepted-projects': projects.filter(item => item.status === 'accepted-local-record').length,
      'resolved-aftercare': this.s.all('aftercare').filter(item => item.storeId === goal.storeId && item.status === 'resolved' && (operational(item) || item.operationalResolutionRecorded)).length,
      'management-reports': this.s.all('report').filter(item => item.goalId === goal.id && item.kind === 'management-loop').length,
    };
    const workflows = this.s.all('workflow').filter(item => item.goalId === goal.id).map(item => ({ id: item.id, kind: item.kind, status: item.status, waitingFor: item.waitingFor ?? null }));
    const pendingApprovals = this.s.all('approval').filter(item => this.approvalStatus(item) === 'pending').map(item => ({ id: item.id, targetType: item.targetType, targetId: item.targetId }));
    const historicalSynthetic = { leads: this.s.all('lead').filter(item => item.storeId === goal.storeId && !operational(item)).length, projects: this.s.all('project').filter(item => item.storeId === goal.storeId && !operational(item)).length, acceptedProjects: this.s.all('project').filter(item => item.storeId === goal.storeId && !operational(item) && item.provenance?.recordStatusAtImport === 'accepted-local-record').length, resolvedAftercare: this.s.all('aftercare').filter(item => item.storeId === goal.storeId && !operational(item) && item.provenance?.recordStatusAtImport === 'resolved').length };
    return { goal: this.safe(goal), metrics, metricBasis: 'operational-local-records-excluding-imported-history', historicalSynthetic, current: metrics[goal.metric], target: goal.target, achievedLocally: metrics[goal.metric] >= goal.target, externallyVerified: false, dataMode: this.s.dataMode, authority: 'local-records-only', workflows, pendingApprovals, externalConnectors: { publishing: 'disabled', messaging: 'disabled', payments: 'disabled', deviceControl: 'disabled' }, evidence: { events: this.s.verify().checkedEvents, ledgerHead: this.s.verify().headHash } };
  }
}
