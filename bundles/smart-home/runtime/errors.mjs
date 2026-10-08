import { createHash } from 'node:crypto';

export class BusinessError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
  toJSON() { return { code: this.code, message: this.message, details: this.details }; }
}

export function assert(condition, code, message, status = 400, details = {}) {
  if (!condition) throw new BusinessError(code, message, status, details);
}

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

export function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function clone(value) { return JSON.parse(JSON.stringify(value)); }

// Validate the published JSON-schema subset without a package download. Unknown
// fields are rejected so a model cannot smuggle approval, scope or execution flags.
export function validate(schema, value, path = '$') {
  const fail = message => { throw new BusinessError('INVALID_INPUT', `${path}: ${message}`, 400, { path }); };
  if (schema.enum && !schema.enum.includes(value)) fail(`must be one of ${schema.enum.join(', ')}`);
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('must be an object');
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    for (const [key, field] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(`forbidden key ${key}`);
      if (!Object.hasOwn(schema.properties ?? {}, key)) {
        if (schema.additionalProperties === false) fail(`unknown field ${key}`);
      } else validate(schema.properties[key], field, `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('must be an array');
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 200)) fail('array length outside bounds');
    for (const [index, field] of value.entries()) validate(schema.items, field, `${path}[${index}]`);
    if (schema.uniqueItems && new Set(value.map(canonical)).size !== value.length) fail('duplicate items');
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') fail('must be a string');
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 5000)) fail('string length outside bounds');
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail('invalid format');
    if (schema.format === 'date-time' && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value)))) fail('must be an ISO date-time with timezone');
  } else if (schema.type === 'integer' || schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isSafeInteger(value))) fail(`must be a finite ${schema.type}`);
    if (value < (schema.minimum ?? -Number.MAX_SAFE_INTEGER) || value > (schema.maximum ?? Number.MAX_SAFE_INTEGER)) fail('number outside bounds');
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') fail('must be a boolean');
  return value;
}

// This local-first runtime stores opaque contact references, never plaintext
// contact details or credentials. A connector must keep PII in its own vault.
export function rejectSecretsAndPII(value, path = '$', depth = 0) {
  assert(depth <= 24, 'INVALID_INPUT', 'Input nesting exceeds 24 levels');
  if (typeof value === 'string') {
    assert(!/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~-]{12,}|\bsk-[A-Za-z0-9_-]{16,})/i.test(value), 'SECRET_REJECTED', `${path}: credentials must not enter business records`);
    assert(!/(?:\b1[3-9]\d{9}\b|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/i.test(value), 'PII_REJECTED', `${path}: use an opaque contactRef, not plaintext contact information`);
  } else if (value && typeof value === 'object') {
    for (const [key, field] of Object.entries(value)) {
      assert(!/^(?:password|token|apiKey|privateKey|phone|email|address|fullName)$/i.test(key), 'SECRET_OR_PII_FIELD', `${path}.${key}: this field is prohibited`);
      rejectSecretsAndPII(field, `${path}.${key}`, depth + 1);
    }
  }
}
