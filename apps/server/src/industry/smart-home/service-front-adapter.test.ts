import { describe, expect, it } from "vitest";
import { runBusinessTool, projectBusinessDialogMatch } from "../../service/adapters/business.js";
import { smartHomeBizAdapter } from "./service-front-adapter.js";

describe("全屋智能公开服务投影", () => {
  const context = { workspaceId: "ws-smart-home", cUserId: "anonymous" };
  it("只展示中文公开服务，不编造设备报价与身份", async () => {
    const result = await runBusinessTool(smartHomeBizAdapter, "query_catalog", context);
    expect(result).toMatchObject({ cardTitle: "全屋智能门店服务", demo: false });
    expect("items" in result && result.items).toHaveLength(5);
    expect(JSON.stringify(result)).not.toMatch(/房型|早餐|住宿|priceText|phone|address/);
    expect(smartHomeBizAdapter.identity).toBeUndefined();
  });
  it("带未知身份或其他成员编号都不能读取项目隐私资料", async () => {
    for (const memberId of [null, "another-customer", "member-1"]) {
      expect(await runBusinessTool(smartHomeBizAdapter, "query_order", { ...context, memberId })).toMatchObject({ orders: [], bindRequired: true });
      expect(await runBusinessTool(smartHomeBizAdapter, "query_member", { ...context, memberId })).toMatchObject({ member: null, bindRequired: true });
    }
  });
  it("咨询、体验、售后和投诉路由使用门店部门", () => {
    expect(smartHomeBizAdapter.ticketKind?.("预约到店体验")).toBe("delivery");
    expect(smartHomeBizAdapter.departmentForTicket?.("delivery")).toBe("体验与勘测协调");
    expect(smartHomeBizAdapter.ticketKind?.("设备漏电冒烟")).toBe("repair");
    expect(smartHomeBizAdapter.ticketKind?.("投诉交付延误")).toBe("complaint");
    expect(smartHomeBizAdapter.ticketKind?.("预算方案咨询")).toBe("other");
    expect(smartHomeBizAdapter.ticketKind?.("你好")).toBeNull();
    expect(smartHomeBizAdapter.departmentForTicket?.("unknown")).toBe("方案顾问");
  });
  it("业务分类文案通过基座中文出口校验", () => {
    for (const input of ["全屋智能设备目录", "我的项目交付进度", "会员权益"]) {
      expect(projectBusinessDialogMatch(smartHomeBizAdapter.classify(input))).not.toBeNull();
    }
    expect(smartHomeBizAdapter.classify("你好")).toBeNull();
  });
});
