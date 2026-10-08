/**
 * 旧酒店契约专用合成数据。仅显式真库测试、回环数据库与已装配的酒店示例工作区可用；
 * 不由产品 bootstrap 或请求路径调用。数据库由测试运行器销毁，平行套件共享固定夹具。
 */
import pg from "pg";

export async function installHotelContractFixture(workspaceId: string, databaseUrl: string): Promise<void> {
  if (process.env.RUN_DB_TESTS !== "1" || process.env.SERVICE_C_TEST_WORKSPACE_ID?.trim() !== workspaceId) {
    throw new Error("酒店契约夹具必须显式启用 RUN_DB_TESTS 并指定 SERVICE_C_TEST_WORKSPACE_ID");
  }
  const url = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("酒店合成夹具只允许回环测试数据库");
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  let client: pg.PoolClient | undefined;
  let discard: Error | undefined;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    // 同工作区并行套件串行核对夹具；已有不同内容的记录不能被测试覆盖。
    const workspace = await client.query<{ industry: string; is_example: boolean }>(
      `SELECT industry, is_example FROM workspaces WHERE id=$1 FOR UPDATE`, [workspaceId],
    );
    if (workspace.rows[0]?.industry !== "hotel" || workspace.rows[0].is_example !== true) {
      throw new Error("酒店契约夹具要求已标记 is_example 的酒店工作区");
    }
    const installs = await client.query<{ bundle_id: string }>(
      `SELECT bundle_id FROM bundle_installs WHERE workspace_id=$1 AND status='active' FOR SHARE`, [workspaceId],
    );
    if (installs.rows.length !== 1 || installs.rows[0]?.bundle_id !== "hotel") {
      throw new Error("酒店契约夹具要求唯一活动 hotel 装配");
    }
    for (const member of [
      { id: "M-1001", name: "SYN-HOTEL-CONTRACT-A", phone: "13800000001", tier: "金卡", points: 2680 },
      { id: "M-1002", name: "SYN-HOTEL-CONTRACT-B", phone: "13800000002", tier: "普通", points: 100 },
    ]) {
      await client.query(
        `INSERT INTO demo_members (workspace_id, member_id, name, phone, tier, points) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (workspace_id, member_id) DO NOTHING`,
        [workspaceId, member.id, member.name, member.phone, member.tier, member.points],
      );
      const row = (await client.query(
        `SELECT name, phone, tier, points FROM demo_members WHERE workspace_id=$1 AND member_id=$2`,
        [workspaceId, member.id],
      )).rows[0];
      if (!row || row.name !== member.name || row.phone !== member.phone || row.tier !== member.tier || row.points !== member.points) {
        throw new Error(`酒店合成夹具标识已被不同内容占用：${member.id}`);
      }
    }
    for (const order of [
      { id: "O-20260820-001", member: "M-1001", room: "豪华大床房", start: "2026-08-20", end: "2026-08-22", amount: 117600, status: "已完成" },
      { id: "O-20260824-002", member: "M-1001", room: "行政双床房", start: "2026-08-24", end: "2026-08-25", amount: 68800, status: "已确认" },
      { id: "O-20260822-003", member: "M-1002", room: "豪华大床房", start: "2026-08-22", end: "2026-08-23", amount: 58800, status: "已完成" },
    ]) {
      await client.query(
        `INSERT INTO demo_orders (workspace_id, order_id, member_id, room_type, check_in, check_out, amount_fen, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (workspace_id, order_id) DO NOTHING`,
        [workspaceId, order.id, order.member, order.room, order.start, order.end, order.amount, order.status],
      );
      const row = (await client.query(
        `SELECT member_id, room_type, check_in::text, check_out::text, amount_fen, status FROM demo_orders
         WHERE workspace_id=$1 AND order_id=$2`, [workspaceId, order.id],
      )).rows[0];
      if (!row || row.member_id !== order.member || row.room_type !== order.room || row.check_in !== order.start ||
          row.check_out !== order.end || row.amount_fen !== order.amount || row.status !== order.status) {
        throw new Error(`酒店合成夹具标识已被不同内容占用：${order.id}`);
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    try { if (client) await client.query("ROLLBACK"); }
    catch (rollback) {
      discard = rollback instanceof Error ? rollback : new Error(String(rollback));
      throw new AggregateError([error, rollback], "酒店契约夹具写入与回滚均失败", { cause: error });
    }
    throw error;
  } finally {
    client?.release(discard);
    await pool.end();
  }
}
