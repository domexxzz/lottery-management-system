import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { BetSlip, type SlipRepresentative, type SlipRestriction } from "./BetSlip";
import { drawDateLabel, lotteryLabel } from "@/lib/bills/betting";
import { billSequencePeriod } from "@/lib/bills/numbering";
import "./new-bill.css";
import "./bet-slip.css";

export const dynamic = "force-dynamic";

const CUTOFF_LABEL = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bangkok",
});

const ROLE_LABEL = { GODMODE: "Godmode", OWNER: "Owner", ADMIN: "Admin", AGENT: "Agent" } as const;

/**
 * หน้าสร้างบิล ใช้หน้าเดียวกันทุกบทบาท
 *
 * โหลดเฉพาะสิ่งที่ต้องใช้ตอนเปิดหน้า (งวด รางวัล เลขเต็ม/อั้น ผู้รับบิล)
 * ชื่อลูกค้าเดิมและโพยเดิมโหลดผ่าน /api/bills/slip-data ภายหลัง
 * เดิมหน้านี้ดึงบิลถึง 5,000 ใบพร้อมรายการเลขทุกครั้งที่เปิด
 */
export default async function NewBillPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "bill.create")) redirect("/bills");

  const sequencePeriod = billSequencePeriod(new Date());
  const drawSelect = { id: true, name: true, drawDate: true, lotteryType: true, cutoffAt: true, status: true } as const;
  const [openDraws, prizeTypes, representatives, ownAgent] = await Promise.all([
    prisma.draw.findMany({
      where: { ...orgScope(actor), status: "OPEN", cutoffAt: { gt: new Date() } },
      orderBy: { cutoffAt: "asc" },
      take: 12,
      select: drawSelect,
    }),
    prisma.prizeType.findMany({
      where: { ...orgScope(actor), isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, digits: true, matchRule: true, payoutRate: true },
    }),
    actor.role === "AGENT"
      ? Promise.resolve(null)
      : prisma.user.findMany({
          where: {
            ...orgScope(actor),
            status: "ACTIVE",
            role: { in: actor.role === "GODMODE" ? ["GODMODE", "OWNER", "ADMIN", "AGENT"] : actor.role === "OWNER" ? ["OWNER", "ADMIN", "AGENT"] : ["ADMIN", "AGENT"] },
            OR: [{ agent: null }, { agent: { status: "ACTIVE" } }],
          },
          orderBy: [{ role: "asc" }, { displayName: "asc" }],
          select: {
            id: true,
            displayName: true,
            role: true,
            agent: {
              select: {
                code: true,
                commissionRate: true,
                billCounters: { where: { period: sequencePeriod }, select: { lastSequence: true }, take: 1 },
              },
            },
          },
        }),
    actor.agentId
      ? prisma.agent.findUnique({
          where: { id: actor.agentId },
          select: {
            commissionRate: true,
            billCounters: { where: { period: sequencePeriod }, select: { lastSequence: true }, take: 1 },
          },
        })
      : Promise.resolve(null),
  ]);

  // ไม่มีงวดเปิดรับ ให้แสดงงวดล่าสุดพร้อมแถบ "หมดเวลาการเดิมพัน"
  const draws = openDraws.length > 0
    ? openDraws
    : await prisma.draw.findMany({ where: orgScope(actor), orderBy: { cutoffAt: "desc" }, take: 1, select: drawSelect });

  const restrictionRows = draws.length === 0 ? [] : await prisma.restrictedNumber.findMany({
    where: { ...orgScope(actor), drawId: { in: draws.map((draw) => draw.id) } },
    select: { drawId: true, prizeTypeId: true, number: true, kind: true, payoutRate: true },
  });
  const restrictions: Record<string, SlipRestriction[]> = {};
  for (const row of restrictionRows) {
    (restrictions[row.drawId] ??= []).push({
      prizeTypeId: row.prizeTypeId,
      number: row.number,
      kind: row.kind,
      payoutRate: row.payoutRate?.toFixed(4) ?? null,
    });
  }

  const slipRepresentatives: SlipRepresentative[] | null = representatives?.map((user) => ({
    id: user.id,
    displayName: user.displayName,
    roleLabel: ROLE_LABEL[user.role],
    agentCode: user.agent?.code ?? null,
    commissionRate: user.agent ? user.agent.commissionRate.toFixed(4) : null,
    nextBillSequence: (user.agent?.billCounters[0]?.lastSequence ?? 0) + 1,
  })) ?? null;

  return (
    <main className="workspace-page new-bill-page bet-slip-page">
      <nav className="bs-breadcrumb" aria-label="ตำแหน่งหน้า">
        <Link href="/">หน้าหลัก</Link><span aria-hidden="true">/</span><Link href="/bills">รายการบิล</Link><span aria-hidden="true">/</span><span>สร้างบิลใหม่</span>
      </nav>
      {draws.length === 0 ? (
        <p className="error">ยังไม่มีงวดในระบบ</p>
      ) : (
        <BetSlip
          draws={draws.map((draw) => ({
            id: draw.id,
            lotteryLabel: lotteryLabel(draw.lotteryType),
            dateLabel: drawDateLabel(draw),
            cutoffAt: draw.cutoffAt.toISOString(),
            cutoffLabel: CUTOFF_LABEL.format(draw.cutoffAt),
            open: draw.status === "OPEN",
          }))}
          prizeTypes={prizeTypes.map((prizeType) => ({ ...prizeType, payoutRate: prizeType.payoutRate.toFixed(4) }))}
          restrictions={restrictions}
          representatives={slipRepresentatives}
          ownCommissionRate={ownAgent ? ownAgent.commissionRate.toFixed(4) : null}
          ownNextBillSequence={(ownAgent?.billCounters[0]?.lastSequence ?? 0) + 1}
        />
      )}
    </main>
  );
}
