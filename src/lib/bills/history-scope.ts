import type { DrawStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orgScope, type Actor } from "@/lib/auth/context";
import { drawDateLabel } from "./betting";
import { drawWhereOf, pickCurrentDraw, scopeOfDraw } from "./draw-scope";
import type { DrawScope, ParsedHistoryFilter } from "./history-filter";

const DRAW_SELECT = { id: true, name: true, drawDate: true, status: true, opensAt: true, cutoffAt: true } as const;

export type ScopeDraw = { id: string; name: string; drawDate: Date | null; status: DrawStatus; opensAt: Date; cutoffAt: Date };

export type ResolvedHistoryScope = {
  scope: DrawScope;
  /** งวดที่ใช้กรองจริง: งวดที่ผู้ใช้เลือก หรืองวดที่เปิดรับอยู่ของขอบเขตปัจจุบัน; "" = ไม่จำกัดงวดเดียว */
  drawId: string;
  /** เงื่อนไขงวดเมื่อไม่ได้เลือกงวดเดียว */
  drawWhere: Prisma.DrawWhereInput | undefined;
  /** งวดที่แสดงป้ายบนหัวหน้า */
  focusDraw: ScopeDraw | null;
  /** ตัวเลือกในช่องงวดตามขอบเขต */
  drawOptions: { value: string; label: string }[];
};

/** ตัวเลือกช่องงวด: งวดเปิดรับเรียงตามปิดรับก่อน งวดอื่นเรียงล่าสุดก่อน */
async function drawsForScope(actor: Actor, scope: DrawScope, now: Date): Promise<ScopeDraw[]> {
  return prisma.draw.findMany({
    where: { ...orgScope(actor), ...drawWhereOf(scope, now) },
    orderBy: { cutoffAt: scope === "current" ? "asc" : "desc" },
    take: 24,
    select: DRAW_SELECT,
  });
}

function toOptions(draws: ScopeDraw[]) {
  return draws.map((draw) => ({ value: draw.id, label: `งวด ${drawDateLabel(draw)}` }));
}

/**
 * แปลงตัวกรองของหน้าประวัติเป็นเงื่อนไขงวดที่ใช้จริง
 *
 * - เลือกงวดเอง: ใช้งวดนั้น และขอบเขตตามงวด (ยกเว้นอยู่ในโหมดทุกงวด)
 * - งวดปัจจุบัน (ค่าเริ่มต้น): งวดที่เปิดรับอยู่ซึ่งปิดรับเร็วที่สุด
 * - งวดย้อนหลัง / ทุกงวด: ทุกงวดในขอบเขตนั้น
 */
export async function resolveHistoryScope(actor: Actor, filter: ParsedHistoryFilter, now = new Date()): Promise<ResolvedHistoryScope> {
  if (filter.drawId) {
    const draw = await prisma.draw.findFirst({ where: { ...orgScope(actor), id: filter.drawId }, select: DRAW_SELECT });
    if (draw) {
      const scope: DrawScope = filter.scope === "all" ? "all" : scopeOfDraw(draw, now);
      const draws = await drawsForScope(actor, scope, now);
      if (!draws.some((item) => item.id === draw.id)) draws.push(draw);
      return { scope, drawId: draw.id, drawWhere: undefined, focusDraw: draw, drawOptions: toOptions(draws) };
    }
    // งวดที่ไม่มีอยู่หรือไม่ใช่ขององค์กรนี้: กรองตาม id เดิม จึงไม่พบรายการ
    const draws = await drawsForScope(actor, filter.scope, now);
    return { scope: filter.scope, drawId: filter.drawId, drawWhere: undefined, focusDraw: null, drawOptions: toOptions(draws) };
  }

  const draws = await drawsForScope(actor, filter.scope, now);
  const focusDraw = filter.scope === "current" ? pickCurrentDraw(draws, now) : null;
  return {
    scope: filter.scope,
    drawId: focusDraw?.id ?? "",
    drawWhere: drawWhereOf(filter.scope, now),
    focusDraw,
    drawOptions: toOptions(draws),
  };
}
