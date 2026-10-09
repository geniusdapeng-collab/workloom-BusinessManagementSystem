export const str = (max = 5000) => ({ type: 'string', minLength: 1, maxLength: max });
export const id = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
export const date = { ...str(40), format: 'date-time' };
export const integer = (min = 0, max = 1000000000) => ({ type: 'integer', minimum: min, maximum: max });
export const number = (min = 0, max = 1) => ({ type: 'number', minimum: min, maximum: max });
export const bool = { type: 'boolean' };
export const en = (...values) => ({ type: 'string', enum: values });
export const arr = (items, min = 0, max = 200) => ({ type: 'array', items, minItems: min, maxItems: max });
export const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const EVIDENCE_SCHEMA = obj({
  uri: { ...str(1000), pattern: '^(https://[^\\s]+|evidence://[A-Za-z0-9._:/-]+)$' },
  sha256: { ...str(64), pattern: '^[a-f0-9]{64}$' },
  source: en('synthetic', 'manufacturer', 'site', 'customer', 'invoice', 'technician'),
  observedAt: date,
  summary: str(1200),
});
