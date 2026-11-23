import { describe, expect, test } from "vitest";
import { parseWinningBillsQuery } from "./winning-bills-query";

describe("parseWinningBillsQuery", () => {
  test("รับงวดคู่ลาวโดยตัดค่าซ้ำและคงตัวกรอง", () => {
    const query = parseWinningBillsQuery({
      lottery: "LAO_COMBINED",
      draws: "drawLao01,drawSet01,drawLao01",
      dashboardDraw: "drawLao01",
      agent: "agent-1",
      from: "2026-11-01",
      to: "2026-11-23",
      page: "2",
    });
    expect(query).toMatchObject({
      lottery: "LAO_COMBINED",
      drawIds: ["drawLao01", "drawSet01"],
      dashboardDrawId: "drawLao01",
      agentId: "agent-1",
      from: "2026-11-01",
      to: "2026-11-23",
      page: 2,
    });
    expect(query.dateFrom?.toISOString()).toBe("2026-10-31T17:00:00.000Z");
    expect(query.dateTo?.toISOString()).toBe("2026-11-23T16:59:59.999Z");
  });

  test("ไม่รับประเภทหวยและวันที่ที่ไม่รู้จัก", () => {
    expect(parseWinningBillsQuery({ lottery: "LAO", from: "23/11/2026", page: "-5" })).toMatchObject({
      lottery: undefined,
      drawIds: [],
      from: "",
      page: 1,
    });
  });
});
