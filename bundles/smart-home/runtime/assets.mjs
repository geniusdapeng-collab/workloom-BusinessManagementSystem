import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BusinessError, assert, clone, rejectSecretsAndPII, validate } from './errors.mjs';
import { INDUSTRY_SECTIONS } from './depth-catalogue.mjs';
import { obj, arr, id, str } from './schema.mjs';
import { SKILLS, EMPLOYEE_SKILLS } from './workforce.mjs';

function read(path) {
  try {
    const url = new URL(`../${path}`, import.meta.url);
    assert(!lstatSync(url).isSymbolicLink(), 'INDUSTRY_ASSET_INVALID', 'Industry assets cannot be symbolic links', 500, { asset: path });
    return readFileSync(url, 'utf8');
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError('INDUSTRY_ASSET_UNAVAILABLE', 'An installed industry asset cannot be read', 500, { asset: path, cause: error.code ?? error.name });
  }
}
function sealedJSON(path) {
  let manifest, data;
  try { manifest = JSON.parse(read('bundle.json')); }
  catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError('INDUSTRY_ASSET_INVALID', 'Industry manifest is invalid JSON', 500);
  }
  const declared = Object.values(manifest.workloom?.provides ?? {}).flatMap(value => typeof value === 'string' ? [value] : Array.isArray(value) ? value : []);
  assert(declared.includes(path), 'INDUSTRY_ASSET_UNDECLARED', 'Industry asset must be declared in the installed manifest', 500, { asset: path });
  const body = read(path), assetDigest = createHash('sha256').update(body).digest('hex');
  assert(manifest.integrity?.assets?.[path] === assetDigest, 'INDUSTRY_ASSET_INTEGRITY', 'Industry asset differs from its sealed digest', 500, { asset: path });
  try { data = JSON.parse(body); }
  catch { throw new BusinessError('INDUSTRY_ASSET_INVALID', 'Industry asset is invalid JSON', 500, { asset: path }); }
  rejectSecretsAndPII(data);
  return { data, assetDigest, sourceAsset: path };
}
export function readIndustryContext(section) {
  const { data: context, assetDigest, sourceAsset } = sealedJSON('library/industry-context.json');
  assert(context.schemaVersion === 'business-management.industry-context/v1' && INDUSTRY_SECTIONS.every(key => context[key] !== undefined) && Object.keys(context).every(key => ['schemaVersion', ...INDUSTRY_SECTIONS].includes(key)), 'INDUSTRY_ASSET_INVALID', 'Industry context has missing or unrecognized sections', 500);
  return { schemaVersion: context.schemaVersion, assetDigest, sourceAsset, externalVerification: false, data: clone(section ? context[section] : context) };
}
export function readSkillTitles() {
  const { data } = sealedJSON('library/skill-catalogue.json');
  assert(data.schemaVersion === 'business-management.skills/v1' && Array.isArray(data.skills) && Object.keys(data).every(key => ['schemaVersion', 'skills'].includes(key)), 'INDUSTRY_ASSET_INVALID', 'Skill title registry has an invalid schema', 500);
  const entries = data.skills.map(skill => ({ key: skill?.key, title: skill?.title, owner: skill?.owner }));
  try { validate(arr(obj({ key: id, title: str(200), owner: id }), 1, 500), entries); }
  catch (error) { throw new BusinessError('INDUSTRY_ASSET_INVALID', 'Skill title registry fields are invalid', 500, { cause: error.code ?? error.name }); }
  assert(entries.length === SKILLS.length && new Set(entries.map(skill => skill.key)).size === SKILLS.length && entries.every(skill => SKILLS.includes(skill.key) && EMPLOYEE_SKILLS[skill.owner]?.includes(skill.key)), 'INDUSTRY_SKILL_OWNERSHIP', 'Skill titles must cover every installed skill exactly once with its accountable owner', 500);
  return Object.fromEntries(entries.map(skill => [skill.key, skill.title]));
}
