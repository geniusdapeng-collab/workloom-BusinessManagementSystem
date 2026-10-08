import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BusinessError, assert, validate, clone } from './errors.mjs';
import { obj, arr, id, str, en } from './catalogue.mjs';

const bundleRoot = new URL('../', import.meta.url);
const readAsset = path => {
  try {
    const location = new URL(path, bundleRoot);
    assert(!lstatSync(location).isSymbolicLink(), 'WORKFORCE_ASSET_INVALID', 'Workforce assets cannot be symbolic links', 500);
    return readFileSync(location, 'utf8');
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError('WORKFORCE_ASSET_UNAVAILABLE', 'An installed workforce asset cannot be read', 500, { asset: path, cause: error.code ?? error.name });
  }
};
const parseAsset = path => {
  try { return JSON.parse(readAsset(path)); }
  catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError('WORKFORCE_ASSET_INVALID', 'An installed workforce asset is not valid JSON', 500, { asset: path });
  }
};
const manifest = parseAsset('bundle.json');
const declared = new Set(Object.values(manifest.workloom?.provides ?? {}).flatMap(value => typeof value === 'string' ? [value] : Array.isArray(value) ? value : []));
const verifiedAsset = path => {
  assert(declared.has(path), 'WORKFORCE_ASSET_UNDECLARED', 'Workforce input must be declared in the installed industry manifest', 500, { asset: path });
  const text = readAsset(path), expected = manifest.integrity?.assets?.[path];
  assert(typeof expected === 'string' && createHash('sha256').update(text).digest('hex') === expected, 'WORKFORCE_ASSET_INTEGRITY', 'Workforce input differs from its sealed industry digest', 500, { asset: path });
  return text;
};
let workforce;
try { workforce = JSON.parse(verifiedAsset('library/workforce.json')); }
catch (error) {
  if (error instanceof BusinessError) throw error;
  throw new BusinessError('WORKFORCE_ASSET_INVALID', 'Workforce registry is not valid JSON', 500);
}
validate(obj({ schemaVersion: en('business-management.workforce/v1'), roles: arr(obj({ id, name: str(200), kind: id, skills: { ...arr(id, 1, 35), uniqueItems: true }, responsibility: str(2000) }), 1, 100) }), workforce);
assert(new Set(workforce.roles.map(role => role.id)).size === workforce.roles.length, 'WORKFORCE_ASSET_INVALID', 'Workforce employee IDs must be unique', 500);
const allSkills = workforce.roles.flatMap(role => role.skills);
assert(new Set(allSkills).size === allSkills.length, 'WORKFORCE_ASSET_INVALID', 'Each skill must have one accountable employee', 500);

export const WORKFORCE = Object.freeze(workforce.roles.map(role => Object.freeze({ ...role, skills: Object.freeze([...role.skills]) })));
export const EMPLOYEES = Object.freeze(WORKFORCE.map(role => role.id));
export const SKILLS = Object.freeze(allSkills);
export const EMPLOYEE_SKILLS = Object.freeze(Object.fromEntries(WORKFORCE.map(role => [role.id, role.skills])));
const skillAssets = new Map();
for (const role of WORKFORCE) for (const skillId of role.skills) {
  validate(id, skillId);
  const assetPath = `skills/${skillId}/SKILL.md`, body = verifiedAsset(assetPath);
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1];
  const field = name => new RegExp(`^${name}:\\s*"([^"]+)"\\s*$`, 'm').exec(front ?? '')?.[1];
  assert(front && field('name') === skillId && field('owner') === role.id && field('version'), 'WORKFORCE_SKILL_OWNERSHIP', 'Skill metadata must match its accountable workforce employee', 500, { employeeId: role.id, skillId });
  const fenceText = /^fence_bindings:\s*(\[[^\n]+\])\s*$/m.exec(front)?.[1];
  let fenceIds;
  try { fenceIds = JSON.parse(fenceText ?? 'null'); } catch { fenceIds = null; }
  assert(Array.isArray(fenceIds) && fenceIds.length > 0 && fenceIds.every(rule => /^R-SH\d+$/.test(rule)), 'WORKFORCE_ASSET_INVALID', 'Skill must declare industry fence IDs', 500, { skillId });
  skillAssets.set(skillId, Object.freeze({ employeeId: role.id, skillId, version: field('version'), assetPath, body, bodyDigest: createHash('sha256').update(body).digest('hex'), fenceIds: Object.freeze(fenceIds) }));
}

export function employeeSkill(employeeId, skillId) {
  assert(EMPLOYEES.includes(employeeId), 'UNKNOWN_EMPLOYEE', 'Employee is not registered in the installed industry workforce');
  assert(SKILLS.includes(skillId), 'UNKNOWN_SKILL', 'Skill is not registered in the installed industry workforce');
  assert(EMPLOYEE_SKILLS[employeeId].includes(skillId), 'EMPLOYEE_SKILL_MISMATCH', 'This skill belongs to another accountable employee', 403, { employeeId, skillId });
  return clone(skillAssets.get(skillId));
}

export const WORKFORCE_SOURCE = fileURLToPath(new URL('library/workforce.json', bundleRoot));
