import { beforeEach, describe, expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { createDraftBill, placeBill, replaceDraftItems, softDeleteBillBeforeCutoff } from "@/lib/bills/service";
import { exposureMap, exposureSummary, listExposure } from "./number-exposure";

let f: Fixtures;
const CAP = new Prisma.Decimal(2000);

beforeEach(async () => {
  f = await freshFixtures();
});

const bet = (prizeTypeId: string, number: string, stake: string) => ({ prizeTypeId, number, stake });

async function place(agent: "AGENT1" | "AGENT2", ...items: ReturnType<typeof bet>[]) {
  return placeBill(f.actors[agent], { drawId: f.draw.id, title: "ลูกค้า", items });
}

const scope = () => ({ drawId: f.draw.id, cap: CAP, organizationId: f.org.id });

describe("ยอดรับต่อเลข (SQL aggregation)", () => {
  test("รวมทุก Agent ทุกบิล แยกประเภท โต๊ดรวมเลขสลับหลัก ไม่นับร่างและบิลยกเลิก", async () => {
    const top = f.prizeTypes.threeTop.id;
    const tod = f.prizeTypes.threeTod.id;
    await place("AGENT1", bet(top, "123", "1000"), bet(tod, "123", "300"));
    await place("AGENT2", bet(top, "123", "500"), bet(tod, "321", "200"));
    await place("AGENT2", bet(tod, "213", "100"));
    const cancelled = await place("AGENT1", bet(top, "123", "400"));
    await softDeleteBillBeforeCutoff(f.actors.AGENT1, cancelled.billId);
    const draft = await createDraftBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ร่าง" });
    await replaceDraftItems(f.actors.AGENT1, draft.billId, [bet(top, "123", "900")]);

    const map = await exposureMap(prisma, scope());
    expect(map.get(`${top}:123`)?.toFixed(2)).toBe("1500.00");
    expect(map.get(`${tod}:123`)?.toFixed(2)).toBe("600.00");
    expect(map.size).toBe(2);

    // ยอดรวมของทุกเลขต้องเท่ายอดของบิลที่มีผลผูกพันพอดี ไม่มีนับซ้ำหรือตกหล่น
    const summary = await exposureSummary(prisma, scope());
    const committed = await prisma.bill.aggregate({
      where: { drawId: f.draw.id, status: { in: ["CONFIRMED", "LOCKED", "SETTLED"] } },
      _sum: { totalStake: true },
    });
    expect(summary.totalStake.toFixed(2)).toBe(committed._sum.totalStake?.toFixed(2));
  });

  test("สถานะ ปกติ / ใกล้เต็ม / เต็ม และยกเลิกบิลแล้วสถานะลดลงทันที", async () => {
    const top = f.prizeTypes.threeTop.id;
    await place("AGENT1", bet(top, "111", "1000"), bet(top, "222", "999"), bet(top, "333", "1000"));
    await place("AGENT2", bet(top, "111", "1000"), bet(top, "333", "700"));
    const last = await place("AGENT2", bet(top, "444", "5"));

    expect(await exposureSummary(prisma, scope())).toMatchObject({ total: 4, normal: 2, near: 1, full: 1 });

    const all = await listExposure(prisma, scope(), { sort: "remaining", direction: "asc" });
    expect(all.rows.map((row) => [row.number, row.status, row.remaining?.toNumber(), row.percent])).toEqual([
      ["111", "full", 0, 100],
      ["333", "near", 300, 85],
      ["222", "normal", 1001, 49.95],
      ["444", "normal", 1995, 0.25],
    ]);

    await softDeleteBillBeforeCutoff(f.actors.AGENT2, last.billId);
    expect(await exposureSummary(prisma, scope())).toMatchObject({ total: 3, normal: 1, near: 1, full: 1 });
  });

  test("กรองสถานะ ประเภท ค้นหาเลข (โต๊ดค้นด้วยเลขสลับหลักได้) และเรียงลำดับ", async () => {
    const top = f.prizeTypes.threeTop.id;
    const tod = f.prizeTypes.threeTod.id;
    await place("AGENT1", bet(top, "123", "100"), bet(top, "456", "1000"), bet(tod, "123", "50"));
    await place("AGENT2", bet(top, "456", "800"), bet(top, "789", "300"));

    const near = await listExposure(prisma, scope(), { status: "near" });
    expect(near.rows.map((row) => row.number)).toEqual(["456"]);

    const todOnly = await listExposure(prisma, scope(), { prizeTypeId: tod });
    expect(todOnly.rows.map((row) => [row.number, row.isPermutation])).toEqual([["123", true]]);

    const search = await listExposure(prisma, scope(), { search: "321" });
    expect(search.rows.map((row) => `${row.prizeTypeCode}:${row.number}`)).toEqual([`${f.prizeTypes.threeTod.code}:123`]);
    const partial = await listExposure(prisma, scope(), { search: "45" });
    expect(partial.rows.map((row) => row.number)).toEqual(["456"]);

    const byUsed = await listExposure(prisma, scope(), { sort: "used", direction: "desc" });
    expect(byUsed.rows.map((row) => row.used.toNumber())).toEqual([1800, 300, 100, 50]);
    const byPercentAsc = await listExposure(prisma, scope(), { sort: "percent", direction: "asc" });
    expect(byPercentAsc.rows[0]?.used.toNumber()).toBe(50);
  });

  test("แบ่งหน้าฝั่ง Server และหน้าที่เกินจำนวนจริงพาไปหน้าสุดท้าย", async () => {
    const top = f.prizeTypes.threeTop.id;
    await place("AGENT1", ...["101", "102", "103", "104", "105"].map((number, index) => bet(top, number, String((index + 1) * 10))));

    const page1 = await listExposure(prisma, scope(), { sort: "used", direction: "desc", pageSize: 2, page: 1 });
    expect(page1).toMatchObject({ total: 5, page: 1, pageCount: 3 });
    expect(page1.rows.map((row) => row.number)).toEqual(["105", "104"]);
    const page3 = await listExposure(prisma, scope(), { sort: "used", direction: "desc", pageSize: 2, page: 3 });
    expect(page3.rows.map((row) => row.number)).toEqual(["101"]);
    const beyond = await listExposure(prisma, scope(), { sort: "used", direction: "desc", pageSize: 2, page: 99 });
    expect(beyond.page).toBe(3);
    expect(beyond.rows.map((row) => row.number)).toEqual(["101"]);
  });

  test("ไม่จำกัดเพดาน: ทุกเลขปกติ ไม่มีคงเหลือหรือเปอร์เซ็นต์", async () => {
    await place("AGENT1", bet(f.prizeTypes.threeTop.id, "999", "1000"));
    const unlimited = { ...scope(), cap: null };
    expect(await exposureSummary(prisma, unlimited)).toMatchObject({ total: 1, normal: 1, near: 0, full: 0 });
    const list = await listExposure(prisma, unlimited);
    expect(list.rows[0]).toMatchObject({ remaining: null, percent: null, status: "normal" });
  });

  test("ไม่เห็นข้อมูลขององค์กรอื่น", async () => {
    await place("AGENT1", bet(f.prizeTypes.threeTop.id, "123", "100"));
    const other = await listExposure(prisma, { ...scope(), organizationId: "another-org" });
    expect(other.total).toBe(0);
  });
});
