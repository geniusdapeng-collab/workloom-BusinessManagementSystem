import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { OPERATION_CATALOGUE } from '../runtime/catalogue.mjs';

const bundleRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(bundleRoot, '..', '..');

function emptyInput(input = {}) {
  if (input === null || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).length) {
    const error = new Error('本只读入口只接受空对象');
    error.code = 'INVALID_INPUT';
    throw error;
  }
}

function json(relativePath, root = bundleRoot) {
  const path = resolve(root, relativePath);
  if (statSync(path).size > 2 * 1024 * 1024) {
    const error = new Error('行业资料超过读取上限');
    error.code = 'TOO_LARGE';
    throw error;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    const error = new Error(`无法读取行业资料 ${relativePath}`, { cause });
    error.code = 'ASSET_INVALID';
    throw error;
  }
}

export function repoStatus(input) {
  emptyInput(input);
  const product = json('product.manifest.json', repositoryRoot);
  return {
    productId: product.productId,
    defaultBundle: product.defaultBundle,
    demoWorkspaceSlug: product.demoWorkspaceSlug,
    entrypoint: 'scripts/business-management.mjs',
    modelProvider: 'host-workbench',
    additionalModelKeyRequired: false,
    dataMode: 'unverified',
    note: '本入口读取仓库清单，不读取或改写经营数据库；实际经营入口以本地操作目录为准。',
  };
}

export function bundleSummary(input) {
  emptyInput(input);
  const manifest = json('bundle.json');
  const provides = manifest.workloom.provides;
  return {
    bundleId: manifest.workloom.industry,
    version: manifest.version,
    status: manifest.workloom.status,
    roles: provides.presets.length,
    skills: provides.skills.length,
    pipelines: provides.pipelines.length,
    operationCount: OPERATION_CATALOGUE.length,
    operations: OPERATION_CATALOGUE.map(({ name, title, risk, readOnly, roles }) => ({ name, title, risk, readOnly, roles })),
    externalConnectors: { socialPublishing: false, ads: false, payment: false, deviceControl: false },
    note: '操作存在表示本地校验和记录能力；外部发布、投放、支付与物理设备控制未启用。',
  };
}

export function knowledgeIndex(input) {
  emptyInput(input);
  const sources = json('library/official-sources.json');
  const faq = json('service-front/faq.json');
  return {
    sources: sources.sources,
    categories: faq.categories.map(({ key, name, docTitle, items }) => ({ key, name, docTitle, questionCount: items.length })),
    note: '知识来源索引不证明现场适配、当前价格或外部账号权限；实际执行前刷新易变事实。',
  };
}
