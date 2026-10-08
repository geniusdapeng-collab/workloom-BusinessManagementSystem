#!/usr/bin/env node
// Interactive guidance; non-interactive installations remain quiet.
if (process.env.CI || !process.stdout.isTTY) process.exit(0);
console.log(`
经营管理系统 · BusinessManagementSystem

依赖安装完成。为当前项目生成 AI 工作台配置并初始化沙箱：
  node scripts/business-management.mjs setup --client all
  node scripts/business-management.mjs init --demo
  pnpm dev

本机工作台：http://127.0.0.1:9393
模型使用当前 Codex / 千问办公 / WorkBuddy 会话，无需额外模型 key。
沙箱业务清楚标识；报价审批与现场事实由人提供。

AI Agent 先读 AGENTS.md、AGENTS.repo.md 和 .ai-prompt。
完整接入：docs/AI-WORKBENCH.md
原平台兼容开发：pnpm setup:foundation / pnpm dev:foundation
`);
