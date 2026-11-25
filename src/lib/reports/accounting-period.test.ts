import { describe, expect, test } from "vitest";
import { accountingHref, compareValueLabel, comparisonText, customCompareQueries, defaultCompareValues, monthSpan, parseAccountingQuery, previousPeriodLabel, previousPeriodQuery, recentDays, recentWeeks, resolveRange } from "./accounting-period";

const NOW = new Date("2026-11-18T05:00:00Z"); // พุธ 18 พ.ย. 2569 เวลาไทย

describe("ช่วงเวลาของสรุปบัญชี", () => {
  test("ค่าเริ่มต้นคือทุกงวด ทุกประเภทหวย และยังไม่เปิดการเทียบ", () => {
    const query = parseAccountingQuery({}, NOW);
    expect(query).toMatchObject({
      period: "all",
      compare: "none",
      lotteries: ["THAI_GOVERNMENT", "LAO", "LAO_SET"],
      agentId: "",
      compareAgentA: "",
      compareAgentB: "",
    });
  });

  test("วันนี้ เมื่อวาน สัปดาห์นี้ และสัปดาห์ที่แล้วใช้วันไทยถูกต้อง", () => {
    expect(resolveRange(parseAccountingQuery({ period: "today" }, NOW), NOW)).toMatchObject({ from: "2026-11-18", to: "2026-11-18" });
    expect(resolveRange(parseAccountingQuery({ period: "yesterday" }, NOW), NOW)).toMatchObject({ from: "2026-11-17", to: "2026-11-17" });
    expect(resolveRange(parseAccountingQuery({ period: "this_week" }, NOW), NOW)).toMatchObject({ from: "2026-11-16", to: "2026-11-18" });
    expect(resolveRange(parseAccountingQuery({ period: "last_week" }, NOW), NOW)).toMatchObject({ from: "2026-11-09", to: "2026-11-15" });
  });

  test("เดือน 3 เดือน 6 เดือน ปีนี้ และปีที่แล้ว", () => {
    expect(resolveRange(parseAccountingQuery({ period: "current_month" }, NOW), NOW)).toMatchObject({ from: "2026-11-01", to: "2026-11-18" });
    expect(resolveRange(parseAccountingQuery({ period: "3m" }, NOW), NOW)).toMatchObject({ from: "2026-09-01", to: "2026-11-18" });
    expect(resolveRange(parseAccountingQuery({ period: "6m" }, NOW), NOW)).toMatchObject({ from: "2026-06-01", to: "2026-11-18" });
    expect(resolveRange(parseAccountingQuery({ period: "current_year" }, NOW), NOW)).toMatchObject({ from: "2026-01-01", to: "2026-11-18" });
    expect(resolveRange(parseAccountingQuery({ period: "previous_year" }, NOW), NOW)).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
  });

  test("ลิงก์เก็บการเทียบ ตัวกรอง Agent และรวมรัฐบาลกับลาวเป็นทุกประเภท", () => {
    const query = parseAccountingQuery({
      period: "this_week",
      agentId: "a1",
      lotteries: "THAI_GOVERNMENT,LAO",
      compare: "1",
    }, NOW);
    expect(query.compare).toBe("previous");
    expect(accountingHref("/reports/accounting", query, {})).toBe(
      "/reports/accounting?period=this_week&agentId=a1&compare=previous",
    );
  });

  test("ช่วงก่อนหน้าสำหรับการเทียบ เลือกช่วงที่ยาวเท่ากันให้อัตโนมัติ", () => {
    const of = (period: string, extra: Record<string, string> = {}) => previousPeriodQuery(parseAccountingQuery({ period, ...extra }, NOW), NOW);
    expect(of("current_draw")).toMatchObject({ period: "previous_draw" });
    expect(of("today")).toMatchObject({ period: "yesterday" });
    expect(of("this_week")).toMatchObject({ period: "last_week" });
    // เดือนนี้ 1–18 พ.ย. เทียบ 1–18 ต.ค.
    expect(of("current_month")).toMatchObject({ period: "custom", from: "2026-10-01", to: "2026-10-18" });
    // ปีนี้ถึงวันนี้ เทียบปีก่อนถึงวันเดียวกัน
    expect(of("current_year")).toMatchObject({ period: "custom", from: "2025-01-01", to: "2025-11-18" });
    // 3 เดือน (1 ก.ย.–18 พ.ย. = 79 วัน) เทียบ 79 วันก่อนหน้าทันที
    expect(of("3m")).toMatchObject({ period: "custom", from: "2026-06-14", to: "2026-08-31" });
    expect(of("custom", { from: "2026-11-10", to: "2026-11-12" })).toMatchObject({ from: "2026-11-07", to: "2026-11-09" });
    expect(of("all")).toBeNull();
    expect(of("previous_year")).toBeNull();
    expect(previousPeriodLabel(parseAccountingQuery({ period: "current_year" }, NOW), NOW)).toBe("ปีที่แล้ว (1 ม.ค. 2568 – 18 พ.ย. 2568)");
    expect(comparisonText(parseAccountingQuery({ period: "current_year" }, NOW), NOW)).toEqual({
      button: "เทียบกับปีที่แล้ว",
      current: "1 ม.ค. 2569 – 18 พ.ย. 2569",
      previous: "1 ม.ค. 2568 – 18 พ.ย. 2568",
    });
    expect(comparisonText(parseAccountingQuery({ period: "current_draw" }, NOW), NOW)?.button).toBe("เทียบกับงวดที่แล้ว");
    expect(comparisonText(parseAccountingQuery({ period: "all" }, NOW), NOW)).toBeNull();
  });

  test("ลาวและลาวชุดเป็นหมวดเดียว รองรับลิงก์เดิม และเลือกศูนย์ประเภทได้", () => {
    expect(parseAccountingQuery({ lotteries: "LAO_SET,THAI_GOVERNMENT" }, NOW).lotteries).toEqual(["THAI_GOVERNMENT", "LAO", "LAO_SET"]);
    expect(parseAccountingQuery({ lottery: "LAO" }, NOW).lotteries).toEqual(["LAO", "LAO_SET"]);
    expect(parseAccountingQuery({ lotteries: "LAO_SET" }, NOW).lotteries).toEqual(["LAO", "LAO_SET"]);
    expect(parseAccountingQuery({ period: "month" }, NOW).period).toBe("current_month");
    const none = parseAccountingQuery({ lotteries: "none" }, NOW);
    expect(none.lotteries).toEqual([]);
    expect(accountingHref("/reports/accounting", none, {})).toContain("lotteries=none");
  });

  test("เลือกเอง: เลือกหน่วยก่อน แล้ว A กับ B เป็นหน่วยเดียวกัน", () => {
    // เดือน: มกราคม เทียบ มีนาคม
    const months = parseAccountingQuery({ compare: "custom", unit: "month", a: "2026-01", b: "2026-03" }, NOW);
    expect(months).toMatchObject({ compare: "custom", compareUnit: "month", compareA: "2026-01", compareB: "2026-03", compareLotteryA: "THAI_GOVERNMENT", compareLotteryB: "LAO_COMBINED" });
    expect(compareValueLabel("month", months.compareA)).toBe("มกราคม 2569");
    const [ma, mb] = customCompareQueries(months, "", "");
    expect(resolveRange(ma, NOW)).toMatchObject({ from: "2026-01-01", to: "2026-01-31" });
    expect(resolveRange(mb, NOW)).toMatchObject({ from: "2026-03-01", to: "2026-03-31" });
    expect(accountingHref("/reports/accounting", months, {})).toContain("compare=custom&unit=month&a=2026-01&b=2026-03");

    const allMonths = parseAccountingQuery({ compare: "custom", unit: "month", a: "all", b: "2026-03" }, NOW);
    const [allMonthA, allMonthB] = customCompareQueries(allMonths, "", "");
    expect(allMonthA).toMatchObject({ period: "all", lotteries: ["THAI_GOVERNMENT"] });
    expect(resolveRange(allMonthB, NOW)).toMatchObject({ from: "2026-03-01", to: "2026-03-31" });

    // วัน: วันเดียวเทียบวันเดียว
    const days = parseAccountingQuery({ compare: "custom", unit: "day", a: "2026-11-01", b: "2026-11-08" }, NOW);
    const [da] = customCompareQueries(days, "", "");
    expect(resolveRange(da, NOW)).toMatchObject({ from: "2026-11-01", to: "2026-11-01" });

    // สัปดาห์: ปัดเป็นวันจันทร์ และนับ 7 วัน
    const weeks = parseAccountingQuery({ compare: "custom", unit: "week", a: "2026-11-12", b: "2026-11-02" }, NOW);
    expect(weeks.compareA).toBe("2026-11-09");
    expect(compareValueLabel("week", weeks.compareA)).toBe("สัปดาห์ 9 พ.ย. 2569 – 15 พ.ย. 2569");
    expect(recentWeeks(2, NOW)[0]!.value).toBe("2026-11-16");

    // งวด: แต่ละฝั่งเลือกประเภทหวยได้อิสระ จึงรองรับไทยเทียบลาวจริง
    const draws = parseAccountingQuery({ compare: "custom", unit: "draw", lotteryA: "THAI_GOVERNMENT", lotteryB: "LAO_COMBINED" }, NOW);
    expect(draws.compareA).toBe("");
    const [wa, wb] = customCompareQueries(draws, "drawAAAAAAAA", "drawBBBBBBBB");
    expect(wa).toMatchObject({ drawIds: ["drawAAAAAAAA"], lotteries: ["THAI_GOVERNMENT"] });
    expect(wb).toMatchObject({ drawIds: ["drawBBBBBBBB"], lotteries: ["LAO", "LAO_SET"] });

    // ช่วงวันที่: A/B มีวันเริ่มและสิ้นสุดของตัวเอง และคงค่าผ่าน URL
    const ranges = parseAccountingQuery({
      compare: "custom", unit: "range", lotteryA: "LAO_COMBINED", lotteryB: "THAI_GOVERNMENT",
      aFrom: "2026-10-01", aTo: "2026-10-15", bFrom: "2026-11-01", bTo: "2026-11-16",
    }, NOW);
    const [ra, rb] = customCompareQueries(ranges, "", "");
    expect(ra).toMatchObject({ from: "2026-10-01", to: "2026-10-15", lotteries: ["LAO", "LAO_SET"] });
    expect(rb).toMatchObject({ from: "2026-11-01", to: "2026-11-16", lotteries: ["THAI_GOVERNMENT"] });
    const rangeHref = accountingHref("/reports/accounting", ranges, {});
    expect(rangeHref).toContain("unit=range");
    expect(rangeHref).toContain("lotteryA=LAO_COMBINED&lotteryB=THAI_GOVERNMENT");
    expect(rangeHref).toContain("aFrom=2026-10-01&aTo=2026-10-15&bFrom=2026-11-01&bTo=2026-11-16");

    // ค่าที่ผิดหน่วยถูกแทนด้วยค่าเริ่มต้น (เดือนนี้ เทียบ เดือนที่แล้ว)
    expect(parseAccountingQuery({ compare: "custom", unit: "month", a: "2026-01-05" }, NOW)).toMatchObject({ compareA: "2026-11", compareB: "2026-10" });
    expect(defaultCompareValues("day", NOW)).toEqual({ a: "2026-11-18", b: "2026-11-17" });
    expect(monthSpan("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });
  test("เทียบกับช่วงก่อน: ช่วงที่เทียบไม่ได้ถือว่าไม่เทียบ ไม่ค้างในลิงก์", () => {
    for (const period of ["all", "previous_year", "previous_draw"]) {
      const query = parseAccountingQuery({ period, compare: "previous" }, NOW);
      expect(query.compare).toBe("none");
      expect(accountingHref("/reports/accounting", query, {})).not.toContain("compare=");
    }
    expect(parseAccountingQuery({ period: "current_month", compare: "previous" }, NOW).compare).toBe("previous");
  });

  test("เทียบรายงวดค่าเริ่มต้นเป็นรวมทุกงวดของประเภทหวย", () => {
    const draws = parseAccountingQuery({ compare: "custom", unit: "draw" }, NOW);
    const [a, b] = customCompareQueries(draws, "", "drawBBBBBBBB");
    expect(a).toMatchObject({ period: "all", lotteries: ["THAI_GOVERNMENT"] });
    expect(a.drawIds).toBeUndefined();
    expect(b.drawIds).toEqual(["drawBBBBBBBB"]);
    expect(accountingHref("/api/reports/accounting", a, {})).toContain("period=all");
  });

  test("ค่าเริ่มต้นเป็นทุก Agent และเลือก Agent ของ A/B แยกกันได้", () => {
    const query = parseAccountingQuery({ compare: "custom", unit: "month", agentA: "agent-a", agentB: "agent-b" }, NOW);
    const [a, b] = customCompareQueries(query, "", "");
    expect(a.agentId).toBe("agent-a");
    expect(b.agentId).toBe("agent-b");
    const href = accountingHref("/reports/accounting", query, {});
    expect(href).toContain("agentA=agent-a&agentB=agent-b");
  });

  test("วันให้เลือกเป็นวันที่แบบไทย และลิงก์ส่งออกของงวดเดียว", () => {
    const days = recentDays(3, NOW);
    expect(days.map((day) => day.value)).toEqual(["2026-11-18", "2026-11-17", "2026-11-16"]);
    expect(days[0]!.label).toBe("วันนี้ (พุธ 18 พ.ย. 2569)");
    const single = parseAccountingQuery({ period: "custom", draw: "drawAAAAAAAA" }, NOW);
    expect(single.drawIds).toEqual(["drawAAAAAAAA"]);
    expect(accountingHref("/api/reports/accounting", single, {})).toContain("draw=drawAAAAAAAA");
  });
});
