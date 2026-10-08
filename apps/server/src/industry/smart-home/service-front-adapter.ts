import type { ServiceFrontBusinessAdapter } from "../../service/adapters/business.js";

/** Public service descriptions contain no tenant records or invented device prices. */
export const smartHomeBizAdapter: ServiceFrontBusinessAdapter = {
  id: "smart-home.service-front-v1",
  kbLexicon: {
    synonyms: [
      ["全屋智能", "智能家居"], ["调试", "场景配置"], ["报修", "售后"],
      ["勘测", "上门测量"], ["网关", "智能中枢"], ["断网", "离线"],
    ],
    weakTokens: ["怎么", "如何", "可以", "服务", "门店", "价格", "多少钱", "咨询", "了解"],
  },
  classify(text) {
    if (/我的(?:项目|合同|报价)|交付进度|订单|账单/.test(text)) {
      return { tool: "query_order", answer: "项目隐私资料需要通过门店核验身份后查询。" };
    }
    if (/会员|积分|权益|余额|客户身份/.test(text)) {
      return { tool: "query_member", answer: "客户身份和权益需要由门店核验，当前入口提供公开咨询。" };
    }
    if (/方案|设备目录|全屋智能|智能家居|灯光|窗帘|门锁|传感器|预算|套餐/.test(text)) {
      return { tool: "query_catalog", answer: "以下是门店提供的全屋智能咨询与交付服务：" };
    }
    return null;
  },
  ticketKind(text) {
    if (/触电|冒烟|起火|漏电|泄露|泄漏|隐私/.test(text)) return "repair";
    if (/售后|维修|报修|故障|掉线|离线|失灵|调试|连不上/.test(text)) return "repair";
    if (/投诉|退款|争议/.test(text)) return "complaint";
    if (/预约|到店|体验|勘测|上门测量/.test(text)) return "delivery";
    if (/方案|预算|咨询|改造/.test(text)) return "other";
    return null;
  },
  departmentForTicket(kind) {
    const departments: Record<string, string> = { repair: "售后与技术服务", complaint: "门店负责人", delivery: "体验与勘测协调", other: "方案顾问" };
    return departments[kind] ?? departments.other!;
  },
  async queryOrder() {
    return { orders: [], demo: false, bindRequired: true, hint: "当前未启用客户身份绑定。请联系门店核验本人身份后查询合同、报价和交付进度。" };
  },
  async queryMember() {
    return { member: null, demo: false, bindRequired: true, hint: "当前未启用客户身份绑定，不展示客户隐私资料或未经核实的会员权益。" };
  },
  async queryCatalog() {
    return {
      cardTitle: "全屋智能门店服务",
      demo: false,
      hint: "设备、价格和工期以现场勘测、型号核查与经批准报价为准。咨询记录不代表预约成功。",
      items: [
        { id: "lighting-scenes", title: "照明与场景咨询", summary: "结合居住习惯设计照明场景，核查回路、零线与设备条件。", details: [{ label: "下一步", value: "到店体验与现场勘测" }] },
        { id: "curtain-comfort", title: "窗帘与舒适场景咨询", summary: "核查轨道、电源、空间与联动需求，明确安装条件。", details: [{ label: "下一步", value: "空间资料与安装条件确认" }] },
        { id: "network-compatibility", title: "网络与设备兼容核查", summary: "按网关、设备型号、固件版本和目标功能逐项核对。", details: [{ label: "依据", value: "厂家资料与实际测试记录" }] },
        { id: "project-delivery", title: "方案报价与项目交付", summary: "从勘测和设备清单推进到采购、安装、调试、培训与客户验收。", details: [{ label: "确认要求", value: "报价审批与现场事实记录" }] },
        { id: "aftercare", title: "售后问题与使用指导", summary: "登记设备离线、场景异常、网络问题和使用培训需求。", details: [{ label: "下一步", value: "门店核验并安排服务" }] },
      ],
    };
  },
};
