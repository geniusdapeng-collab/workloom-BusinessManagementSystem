import { useState } from "react";

function SmartHomeWorkbenchEntry() {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const command = "node scripts/business-management.mjs serve --port 9393";
  async function copyCommand() {
    setError("");
    try { await navigator.clipboard.writeText(command); setCopied(true); }
    catch { setError("浏览器未允许复制。请选中下方命令，复制到项目目录中的终端运行。"); }
  }
  return <main className="mx-auto max-w-5xl space-y-6 px-5 py-8" aria-label="全屋智能门店经营台入口">
    <div className="space-y-3"><p className="text-body text-ink3">全屋智能门店</p><h1 className="text-h1 font-bold text-ink1">把客户需求，推进为有依据的交付。</h1><p className="max-w-3xl text-body leading-relaxed text-ink2">门店经营台提供线索、体验、现场勘测、方案设备清单、报价审批、项目交付、售后与经营目标。AI 工作台内置模型领取数字员工任务，本地系统保存业务记录并核验执行条件。</p></div>
    <div className="grid gap-4 md:grid-cols-2">{[
      ["获客与体验", "记录渠道归因、用途授权、内容依据和到店计划；对外发布须具备正式渠道与店主批准。"],
      ["方案与交付", "按勘测、兼容依据、报价、采购、安装、调试和验收依赖推进；现场事实由人员登记。"],
      ["售后与回访", "将故障分级、处理期限、解决依据和客户确认连在同一资料链中。"],
      ["经营目标与团队", "按目标拆解工作流，数字员工领取带租约的任务，提交结构化产物并反馈本地证据。"],
    ].map(([title, text]) => <section key={title} className="rounded-xl border border-line bg-card p-5"><h2 className="mb-3 text-h2 font-semibold text-ink1">{title}</h2><p className="text-body leading-relaxed text-ink2">{text}</p></section>)}</div>
    <section className="space-y-4 rounded-xl border border-line bg-card p-6"><h2 className="text-h2 font-semibold text-ink1">打开门店经营台</h2><p className="text-body leading-relaxed text-ink2">先在本机项目目录启动经营台，再打开下方入口。默认使用端口 9393；使用自定义端口时，以终端输出的地址为准。</p><pre className="overflow-auto rounded-lg bg-bg950 p-4 text-body text-ink1">{command}</pre><div className="flex flex-wrap gap-3"><button className="wl-button wl-button--secondary" onClick={() => { void copyCommand(); }}>{copied ? "启动命令已复制" : "复制启动命令"}</button><a className="wl-button wl-button--primary" href="http://127.0.0.1:9393" target="_blank" rel="noopener noreferrer">打开本机经营台 ↗</a><a className="wl-button wl-button--secondary" href="https://cnb.cool/workloom-ai/workloom-BusinessManagementSystem/-/blob/main/docs/AI-WORKBENCH.md" target="_blank" rel="noopener noreferrer">阅读 AI 工作台接入说明 ↗</a></div>{error ? <p className="text-body text-warn" role="alert">{error}</p> : null}<p className="text-body leading-relaxed text-ink3">此行业入口由已安装的行业包与当前身份权限控制。经营台使用自己的本地工作区和人员确认会话；平台资料库与本地经营台数据分别保存，目前没有双向同步。</p></section>
  </main>;
}

export const industryRoutes = [{ path: "/smart-home/workbench", capabilityId: "smart-home.workbench", element: <SmartHomeWorkbenchEntry /> }] as const;
