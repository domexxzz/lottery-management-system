import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listPrizeTypes } from "@/lib/prizeTypes/service";
import { PrizeTypeRow } from "./PrizeTypeRow";
import "./rulebook.css";

export const dynamic = "force-dynamic";

const MATCH_RULE_LABEL: Record<string, string> = {
  EXACT: "ตรงทุกหลัก",
  PERMUTATION: "โต๊ด",
  CONTAINS_DIGIT: "วิ่ง",
};

export default async function PrizeTypesPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const prizeTypes = await listPrizeTypes(actor);
  const canEdit = can(actor.role, "draw.manage");
  const confirmedItems = prizeTypes.reduce((sum, p) => sum + p._count.billItems, 0);

  return (
    <main className="workspace-page rulebook-page">
      <section className="card workspace-card" aria-labelledby="rulebook-heading">
        <p><Link href="/">← หน้าภาพรวม</Link></p>
        <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">Prize Configuration</p><h1 id="rulebook-heading">Rulebook รางวัล</h1><p>กำหนดประเภทรางวัล อัตราจ่าย วิธีตัดสิน และวงเงินอย่างควบคุม</p></div><span className="rulebook-count">{prizeTypes.length}<small>ประเภทรางวัล</small></span></header>

        <p className="muted">
          ค่าในหน้านี้คือสิ่งที่ LOT-28 และ LOT-31 ต้องยืนยัน การแก้ที่นี่ไม่ต้อง deploy ใหม่
          และทุกการแก้บันทึกลง Audit Log พร้อมเหตุผล
        </p>

        <p className="notice">
          การแก้อัตราจ่ายไม่กระทบบิลที่ยืนยันไปแล้ว เพราะแต่ละรายการเก็บอัตราจ่าย
          ของตัวเองไว้ตั้งแต่ตอนยืนยัน ขณะนี้มี {confirmedItems} รายการที่ล็อกอัตราไว้แล้ว
        </p>

        {!canEdit && <p className="muted">บทบาทของคุณดูได้อย่างเดียว</p>}

        <div className="table-wrap"><table className="rulebook">
          <thead>
            <tr>
              <th scope="col">รหัส</th>
              <th scope="col" colSpan={7}>
                ชื่อ · หลักเลขที่แทง · หลักผลรางวัล · อัตราจ่าย · วงเงินต่อรายการ · วิธีตัดสิน ·
                เปิดใช้ · เหตุผล
              </th>
            </tr>
          </thead>
          <tbody>
            {prizeTypes.map((p) =>
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
                    payoutRate: p.payoutRate.toFixed(4),
                    maxStakePerItem: p.maxStakePerItem?.toFixed(2) ?? "",
                    isActive: p.isActive,
                    usedInItems: p._count.billItems,
                  }}
                />
              ) : (
                <tr key={p.id}>
                  <td>
                    <strong>{p.code}</strong>
                  </td>
                  <td colSpan={7}>
                    {p.name} · แทง {p.digits} หลัก ·{" "}
                    {p.resultDigits !== null && p.resultDigits !== p.digits
                      ? `ผล ${p.resultDigits} หลัก · `
                      : ""}
                    จ่าย {p.payoutRate.toFixed(4)} ·{" "}
                    {p.maxStakePerItem === null
                      ? "ไม่จำกัดต่อรายการ"
                      : `สูงสุด ${p.maxStakePerItem.toFixed(2)}`}
                    {" · "}
                    {MATCH_RULE_LABEL[p.matchRule] ?? p.matchRule}
                    {!p.isActive && " · ปิดใช้งาน"}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table></div>
      </section>
    </main>
  );
}
