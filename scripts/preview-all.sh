#!/usr/bin/env bash
# WorkLoom · 三端全貌一键预览（preview:all）
#
#   PC 端 · B 端工作台        → http://localhost:3000
#   移动端 · B 端工作台       → http://localhost:3001（apps/webb）
#   移动端 · C 端（AI 服务前台 H5）→ http://localhost:3002（小程序入口模拟）
#   数据/网关 server           → http://localhost:8787（tRPC /trpc/* · C 端 /c/*）
#
# Mock 模式强制启用：种子演示数据 + 离线确定性模型 + C 端演示直登，无需任何真实后端/密钥。
# 用法：pnpm preview:all（Ctrl+C 一键全部停止）
set -eu
cd "$(dirname "$0")/.."

PC_PORT=3000; MB_PORT=3001; MC_PORT=3002; SERVER_PORT=8787
export SERVICE_C_DEMO_AUTH=true SERVICE_C_WORKSPACE_ID="${SERVICE_C_WORKSPACE_ID:-ws-smart-home}" TOOL_UNVERIFIED_RATE=0 LLM_PROVIDER=mock IM_DRIVER=mock
export WEB_PORT=$PC_PORT WEBB_PORT=$MB_PORT WEBC_PORT=$MC_PORT SERVER_PORT=$SERVER_PORT

say() { printf "\033[1;36m[preview:all]\033[0m %s\n" "$1"; }
PIDS=""
# 端口清理兼容 macOS（lsof）与 Linux（ss）：macOS 自带 bash 3.2 且无 ss。
check_port() {
  local P=$1 PID=""
  if command -v lsof >/dev/null 2>&1; then
    PID=$(lsof -nP -iTCP:"$P" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
  elif command -v ss >/dev/null 2>&1; then
    PID=$(ss -tlnp 2>/dev/null | grep ":$P " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
  fi
  if [ -n "$PID" ]; then
    say ":${P} 已被 PID=${PID} 使用；请配置独立预览端口后重试。"
    return 1
  fi
  return 0
}
cleanup() { say "停止三端预览…"; for P in $PIDS; do kill "$P" 2>/dev/null; done; }
trap cleanup EXIT INT TERM

# ---------- 0. 清端口 ----------
for P in $PC_PORT $MB_PORT $MC_PORT $SERVER_PORT; do check_port "$P"; done

# ---------- 1. 数据库 + 模拟数据固化（幂等） ----------
say "应用数据库迁移…"
pnpm db:migrate >/tmp/preview-all-migrate.log 2>&1 || { echo "迁移失败 → /tmp/preview-all-migrate.log"; exit 1; }
say "注入当前产品沙箱：pnpm db:seed"
pnpm db:seed >/tmp/preview-all-seed.log 2>&1 || { echo "种子失败 → /tmp/preview-all-seed.log"; exit 1; }

# ---------- 2. 起 server（Mock 模式） ----------
say "启动 server :${SERVER_PORT}（Mock：离线确定性模型 + 演示直登）"
pnpm -C apps/server start >/tmp/preview-all-server.log 2>&1 &
PIDS="$PIDS $!"

# ---------- 3. 起三端 ----------
say "启动 PC 端 :${PC_PORT}（apps/web）"
pnpm -C apps/web exec vite --port $PC_PORT --strictPort >/tmp/preview-all-pc.log 2>&1 &
PIDS="$PIDS $!"

say "启动 B 端移动 :${MB_PORT}（apps/webb）"
pnpm -C apps/webb exec vite --port "$MB_PORT" --strictPort >/tmp/preview-all-mb.log 2>&1 &
PIDS="$PIDS $!"

say "启动 C 端 :${MC_PORT}（apps/webc，小程序入口 H5 模拟）"
pnpm -C apps/webc exec vite --port $MC_PORT --strictPort >/tmp/preview-all-mc.log 2>&1 &
PIDS="$PIDS $!"

# ---------- 4. 等待就绪 ----------
for P in $SERVER_PORT $PC_PORT $MB_PORT $MC_PORT; do
  READY=0
  for i in $(seq 1 30); do
    if [ "$P" = "$SERVER_PORT" ]; then
      if curl -sf -o /dev/null "http://127.0.0.1:$P/health" 2>/dev/null; then READY=1; break; fi
    elif curl -sf -o /dev/null "http://127.0.0.1:$P" 2>/dev/null; then READY=1; break
    fi
    sleep 1
  done
  if [ "$READY" != 1 ]; then say ":${P} 在限时内未就绪；检查预览日志。"; exit 1; fi
done

# ---------- 5. 横幅 ----------
echo
printf "\033[1;35m"
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║            WorkLoom · 三端全貌预览已就绪（Mock 数据模式）          ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  🖥  PC 端 · B 端工作台        http://localhost:3000               ║"
echo "║  📱 移动端 · B 端工作台         http://localhost:3001               ║"
echo "║  📱 移动端 · C 端（服务前台）   http://localhost:3002               ║"
echo "║  ⚙️  server（tRPC + C 端网关）  http://localhost:8787               ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  Mock 数据已加载：种子演示数据集 + 离线确定性模型 + C 端演示直登     ║"
echo "║  当前预览端：PC(3000) / B移动(3001) / C移动(3002) —— Ctrl+C 停止   ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
printf "\033[0m"
echo "日志：/tmp/preview-all-{server,pc,mb,mc}.log"

wait
