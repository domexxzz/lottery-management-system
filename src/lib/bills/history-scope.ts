import type { DrawStatus, LotteryType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orgScope, type Actor } from "@/lib/auth/context";
import { drawDateLabel, lotteryLabel } from "./betting";
import { drawWhereOf, pickCurrentDraw, scopeOfDraw } from "./draw-scope";
import type { DrawScope, ParsedHistoryFilter } from "./history-filter";

const DRAW_SELECT = { id: true, name: true, drawDate: true, status: true, opensAt: true, cutoffAt: true, lotteryType: true } as const;

export type ScopeDraw = { id: string; name: string; drawDate: Date | null; status: DrawStatus; opensAt: Date; cutoffAt: Date; lotteryType: LotteryType };

export type ResolvedHistoryScope = {
  scope: DrawScope;
  /** งวดที่ใช้กรองจริง: งวดที่ผู้ใช้เลือก หรืองวดที่เปิดรับอยู่ของขอบเขตปัจจุบัน; "" = ไม่จำกัดงวดเดียว */
  drawId: string;
  /** เงื่อนไขงวดเมื่อไม่ได้เลือกงวดเดียว */
  drawWhere: Prisma.DrawWhereInput | undefined;
  /** งวดที่แสดงป้ายบนหัวหน้า */
  focusDraw: ScopeDraw | null;
  /** ตัวเลือกในช่องงวดตามขอบเขต (เฉพาะประเภทหวยที่เลือก) */
  drawOptions: { value: string; label: string; lotteryType: LotteryType }[];
  /** ขอบเขตงวดปัจจุบันแต่ไม่มีงวดที่ค้างอยู่เลย (ของประเภทหวยที่เลือก) */
  noCurrentDraw: boolean;
};

/** ตัวเลือกช่องงวด: งวดเปิดรับเรียงตามปิดรับก่อน งวดอื่นเรียงล่าสุดก่อน */
async function drawsForScope(actor: Actor, scope: DrawScope, now: Date, lotteryType?: LotteryType): Promise<ScopeDraw[]> {
  return prisma.draw.findMany({
    where: { ...orgScope(actor), ...drawWhereOf(scope, now), ...(lotteryType ? { lotteryType } : {}) },
    orderBy: { cutoffAt: scope === "current" ? "asc" : "desc" },
    take: 24,
    select: DRAW_SELECT,
  });
}

/** ดูทุกประเภทหวยอยู่: เติมชื่อประเภทหน้าวันที่ ไม่ให้หวยลาวกับหวยลาวชุดวันเดียวกันสับสน */
function toOptions(draws: ScopeDraw[], withLottery: boolean) {
  return draws.map((draw) => ({
    value: draw.id,
    label: withLottery ? `${lotteryLabel(draw.lotteryType)} · งวด ${drawDateLabel(draw)}` : `งวด ${drawDateLabel(draw)}`,
    lotteryType: draw.lotteryType,
  }));
}

/**
 * แปลงตัวกรองของหน้าประวัติเป็นเงื่อนไขงวดที่ใช้จริง
 *
 * - เลือกงวดเอง: ใช้งวดนั้น และขอบเขตตามงวด (ยกเว้นอยู่ในโหมดทุกงวด)
 * - งวดปัจจุบัน (ค่าเริ่มต้น): เลือกประเภทหวยแล้ว = งวดของประเภทนั้นที่ปิดรับเร็วที่สุด
 *   ดูทุกประเภท = ทุกงวดปัจจุบันของทุกประเภทหวย (หวยรัฐบาล หวยลาว หวยลาวชุด พร้อมกัน)
 * - งวดย้อนหลัง / ทุกงวด: ทุกงวดในขอบเขตนั้น
 */
export async function resolveHistoryScope(actor: Actor, filter: ParsedHistoryFilter, now = new Date()): Promise<ResolvedHistoryScope> {
  const lotteryType = filter.lotteryType;
  const withLottery = !lotteryType;
  if (filter.drawId) {
    const draw = await prisma.draw.findFirst({ where: { ...orgScope(actor), id: filter.drawId }, select: DRAW_SELECT });
    if (draw) {
      const scope: DrawScope = filter.scope === "all" ? "all" : scopeOfDraw(draw, now);
      const draws = await drawsForScope(actor, scope, now, lotteryType);
      if (!draws.some((item) => item.id === draw.id)) draws.push(draw);
      return { scope, drawId: draw.id, drawWhere: undefined, focusDraw: draw, drawOptions: toOptions(draws, withLottery), noCurrentDraw: false };
    }
    // งวดที่ไม่มีอยู่หรือไม่ใช่ขององค์กรนี้: กรองตาม id เดิม จึงไม่พบรายการ
    const draws = await drawsForScope(actor, filter.scope, now, lotteryType);
    return { scope: filter.scope, drawId: filter.drawId, drawWhere: undefined, focusDraw: null, drawOptions: toOptions(draws, withLottery), noCurrentDraw: false };
  }

  const draws = await drawsForScope(actor, filter.scope, now, lotteryType);
  // ปักงวดเดียวเฉพาะตอนเลือกประเภทหวยแล้ว ถ้าดูทุกประเภทให้เห็นบิลงวดปัจจุบันของทุกประเภทพร้อมกัน
  const focusDraw = filter.scope === "current" && lotteryType ? pickCurrentDraw(draws, now) : null;
  const noCurrentDraw = filter.scope === "current" && (lotteryType ? !focusDraw : draws.length === 0);
  return {
    scope: filter.scope,
    drawId: focusDraw?.id ?? "",
    drawWhere: drawWhereOf(filter.scope, now),
    focusDraw,
    drawOptions: toOptions(draws, withLottery),
    noCurrentDraw,
  };
}
