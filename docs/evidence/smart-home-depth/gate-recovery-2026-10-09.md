# 门禁恢复记录（T-2026-1009-0001，2026-10-09）

本文件记录源提交 `2aa3f2f890e21cbb9e62abd55ee73f6003d2e40b` 在 PR #4 上的必需门禁失败、
根因、修复与本地复核结果。CI 原始读数来自 CNB 构建 `cnb-l98-1k4fhivaj`（pull_request 事件，
预合并提交 `5c1b93cd65f60a0f8ce3f23739855ae119c1359f`）。

## 1. static-gate：清洁阶段把“上下文已关闭”当成基础设施失败

- 失败阶段：`pipeline-3(static-gate)` → 第 8 阶段“媒体真实解码与完整 CLI 回归（隔离夹具）”，耗时 105490ms，状态 `error`。
- 业务断言本身全部通过：媒体解码 7/7、`check-business-workbench.mjs` 22/22。
- 真实报错：

  ```
  AggregateError: Browser regression infrastructure or cleanup failed
      [errors]: [ browserContext.close: Protocol error (Target.disposeBrowserContext):
        Failed to find context with id 6AF080E89743865689B1357F256D7CBB ]
  ```

- 根因：`scripts/check-business-workbench.mjs` 在 `finally` 里用
  `Promise.allSettled([context?.close(), browser?.close(), server?.close()])` **并发**关闭
  context 与 browser。`browser.close()` 会先销毁其全部 context，随后 context 的 dispose 请求
  找不到目标，于是把一次稳定通过的业务回归判成红灯。这是清理路径的竞态，不是产品缺陷。
- 修复：改为按序关闭（context → browser → server），并且只把“目标已不存在”的关闭错误
  （`Failed to find context` / `Target page, context or browser has been closed` /
  `Browser has been closed` / `TargetClosedError`）视为良性；其它关闭错误仍计入
  `cleanupErrors` 并使进程非零退出。
- 同类修复：`scripts/check-smart-home-depth.mjs` 的顺序关闭同样对“目标已不存在”的错误做
  良性豁免，其它清理错误保持失败语义。

## 2. test-gate（非阻断）：岗位数量断言过时

- 失败阶段：`pipeline-5(test-gate)` → “主测试套件（非阻断）”；
  `packages/base` 的 `bundles/assembly-safety.test.ts` 断言
  `readVerifiedBundleJsonAsset("smart-home", "library/workforce.json").roles` 长度为 20，
  实际为 27（本任务补齐 7 个岗位）。
- 修复：断言改为与 `bundles/smart-home/library/workforce.json` 的实际声明逐项相等
  （`expect(asset.roles).toEqual(declared.roles)`）。验证目标不变——校验“清单校验后读到的是
  完整声明资产”，但不再依赖会随岗位扩充而失效的硬编码数字。

## 3. db-gate：环境侧瞬时失败

- 失败阶段：`pipeline-4(db-gate)` → 第 1 阶段“准备 Node 24 与 pnpm”，耗时 20816ms。
- 真实报错：`corepack prepare pnpm@10.14.0` 拉取 `https://registry.npmjs.org/pnpm/-/pnpm-10.14.0.tgz`
  失败（`Internal Error: Error when performing the request ...`）。同一命令在 static-gate 的
  node 镜像中成功，属于 runner 侧网络抖动，非源码缺陷。按“重新触发原生 CI 取得真实读数”处理，
  不修改 `.cnb.yml`。

## 4. 本地复核（修复后，源码树未提交时执行）

- `pnpm test:business`：171 项，170 通过 / 1 条件跳过（未启用 PostgreSQL 环境）/ 0 失败。
- `pnpm -C packages/base exec vitest run bundles/assembly-safety.test.ts`：15 通过 / 3 条件跳过。
- `node scripts/check-business-workbench.mjs --channel chrome`：22/22 通过，清理阶段不再抛错。
- `node scripts/check-smart-home-depth.mjs --channel chrome`：11/11 通过。

本地复核使用真实 Chrome 与合成沙箱数据，不代表生产环境或客户现场验收。
