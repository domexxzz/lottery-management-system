import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { listRestrictions } from "@/lib/draws/restrictions";
import { compactRate, drawDateLabel } from "@/lib/bills/betting";
import { listPrizeTypes } from "@/lib/prizeTypes/service";
import { RestrictionManager } from "../draws/[id]/RestrictionManager";
import { PrizeTypeRow } from "./PrizeTypeRow";
import { RulebookDrawPicker } from "./RulebookDrawPicker";
import "./rulebook.css";

export const dynamic = "force-dynamic";

const MATCH_RULE_LABEL: Record<string, string> = {
  EXACT: "ตรงทุกหลัก",
  PERMUTATION: "โต๊ด",
  CONTAINS_DIGIT: "วิ่ง",
};

export default async function PrizeTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ drawId?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const query = await searchParams;
  const [prizeTypes, openDraws] = await Promise.all([
    listPrizeTypes(actor),
    prisma.draw.findMany({
      where: { ...orgScope(actor), status: "OPEN" },
      orderBy: [{ cutoffAt: "asc" }, { createdAt: "desc" }],
      select: { id: true, name: true, drawDate: true, cutoffAt: true },
    }),
  ]);
  const visiblePrizeTypes = prizeTypes.filter((prizeType) => ![10, 11].includes(prizeType.code));
  const canEdit = can(actor.role, "draw.manage");
  const confirmedItems = visiblePrizeTypes.reduce((sum, p) => sum + p._count.billItems, 0);
  const selectedDraw = openDraws.find((draw) => draw.id === query.drawId) ?? openDraws[0];
  const restrictionRows = selectedDraw ? await listRestrictions(actor, selectedDraw.id) : [];
  const restrictionPrizeTypes = visiblePrizeTypes.filter((prizeType) => prizeType.isActive);

  return (
    <main className="workspace-page rulebook-page">
      <section className="card workspace-card rulebook-hero-card" aria-labelledby="rulebook-heading">
        <p><Link href="/">← หน้าภาพรวม</Link></p>
        <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">Prize Configuration</p><h1 id="rulebook-heading">Rulebook รางวัล</h1><p>จัดการอัตราจ่ายและเลขอั้นจากศูนย์กลางเดียว</p></div><span className="rulebook-count">{visiblePrizeTypes.length}<small>ประเภทรางวัล</small></span></header>
        <nav className="rulebook-jump" aria-label="หัวข้อ Rulebook">
          <a href="#payout-rates"><span>1</span>กำหนดอัตราจ่าย</a>
          <a href="#number-restrictions"><span>2</span>กำหนดเลขอั้น</a>
        </nav>
      </section>

      <section id="payout-rates" className="card workspace-card rulebook-section" aria-labelledby="payout-rates-heading">
        <header className="rulebook-section-heading">
          <span>1</span>
          <div><p className="page-eyebrow">Payout Rules</p><h2 id="payout-rates-heading">กำหนดอัตราจ่าย</h2><p>กำหนดประเภท อัตราจ่าย วิธีตรวจรางวัล และวงเงินต่อรายการ</p></div>
        </header>

        <p className="muted">
          ค่าในหน้านี้คือสิ่งที่ LOT-28 และ LOT-31 ต้องยืนยัน การแก้ที่นี่ไม่ต้อง deploy ใหม่
          และทุกการแก้บันทึกลง Audit Log พร้อมเหตุผล
        </p>

        <p className="notice">
          การแก้อัตราจ่ายไม่กระทบบิลที่ยืนยันไปแล้ว เพราะแต่ละรายการเก็บอัตราจ่าย
          ของตัวเองไว้ตั้งแต่ตอนยืนยัน ขณะนี้มี {confirmedItems} รายการที่ล็อกอัตราไว้แล้ว
        </p>

        {!canEdit && <p className="muted">บทบาทของคุณดูได้อย่างเดียว</p>}

        <div className="rulebook-prize-list">
          {visiblePrizeTypes.map((p) =>
              canEdit ? (
                <PrizeTypeRow
                  key={p.id}
                  data={{
                    id: p.id,
                    code: p.code,
                    name: p.name,
                    digits: p.digits,
                    resultDigits: p.resultDigits?.toString() ?? "",
                    matchRule: p.matchRule,
                    payoutRate: compactRate(p.payoutRate),
                    maxStakePerItem: p.maxStakePerItem ? compactRate(p.maxStakePerItem) : "",
                    isActive: p.isActive,
                    usedInItems: p._count.billItems,
                  }}
                />
              ) : (
                <article key={p.id} className={`rulebook-prize-readonly ${p.isActive ? "is-active" : "is-inactive"}`}>
                  <span className="rulebook-prize-code">{p.code}</span>
                  <div><strong>{p.name}</strong><small>แทง {p.digits} หลัก · {MATCH_RULE_LABEL[p.matchRule] ?? p.matchRule}</small></div>
                  <p><small>จ่ายบาทละ</small><strong>{p.payoutRate.toNumber().toLocaleString("th-TH", { maximumFractionDigits: 4 })}</strong></p>
                  <span className={`rulebook-prize-status ${p.isActive ? "is-on" : "is-off"}`}>{p.isActive ? "เปิดใช้งาน" : "ปิดใช้งาน"}</span>
                </article>
              ),
          )}
        </div>
      </section>

      <section id="number-restrictions" className="card workspace-card rulebook-section" aria-labelledby="number-restrictions-heading">
        <header className="rulebook-section-heading">
          <span>2</span>
          <div><p className="page-eyebrow">Number Controls</p><h2 id="number-restrictions-heading">กำหนดเลขอั้น</h2><p>เลือกงวด ขอบเขต และใส่เลขที่ต้องการลดอัตราจ่าย</p></div>
        </header>

        {openDraws.length === 0 || !selectedDraw ? (
          <p className="notice">ยังไม่มีงวดที่เปิดรับ จึงยังไม่สามารถกำหนดเลขอั้นได้</p>
        ) : (
          <>
            <RulebookDrawPicker
              value={selectedDraw.id}
              draws={openDraws.map((draw) => ({
                id: draw.id,
                name: draw.name,
                dateLabel: draw.drawDate
                  ? `${new Intl.DateTimeFormat("th-TH", { dateStyle: "long", timeZone: "Asia/Bangkok" }).format(draw.drawDate)} (${new Intl.DateTimeFormat("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bangkok" }).format(draw.drawDate)})`
                  : `งวด ${drawDateLabel(draw)}`,
                cutoffLabel: new Intl.DateTimeFormat("th-TH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "Asia/Bangkok",
                }).format(draw.cutoffAt),
              }))}
            />
            <p className="rulebook-draw-note">กำลังตั้งค่าสำหรับ <strong>งวด {drawDateLabel(selectedDraw)}</strong> · ปิดรับ {selectedDraw.cutoffAt.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</p>
            <RestrictionManager
              drawId={selectedDraw.id}
              editable={canEdit}
              prizeTypes={restrictionPrizeTypes.map((prizeType) => ({
                id: prizeType.id,
                code: prizeType.code,
                name: prizeType.name,
                digits: prizeType.digits,
                payoutRate: compactRate(prizeType.payoutRate),
              }))}
              rows={restrictionRows.map((row) => ({
                id: row.id,
                number: row.number,
                kind: row.kind,
                payoutRate: row.payoutRate ? compactRate(row.payoutRate) : null,
                prizeTypeName: row.prizeType.name,
                normalRate: compactRate(row.prizeType.payoutRate),
              }))}
            />
          </>
        )}
      </section>
    </main>
  );
}
