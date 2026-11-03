import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listPrizeTypes } from "@/lib/prizeTypes/service";
import { PrizeTypeRow } from "./PrizeTypeRow";
import "./rulebook.css";

export const dynamic = "force-dynamic";

export default async function PrizeTypesPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const prizeTypes = await listPrizeTypes(actor);
  const canEdit = can(actor.role, "draw.manage");
  const confirmedItems = prizeTypes.reduce((sum, p) => sum + p._count.billItems, 0);

  return (
    <main>
      <section className="card" aria-labelledby="rulebook-heading">
        <p>
          <Link href="/">← หน้าแรก</Link>
        </p>
        <h1 id="rulebook-heading">Rulebook รางวัล 1 ถึง 16</h1>

        <p className="muted">
          ค่าในหน้านี้คือสิ่งที่ LOT-28 และ LOT-31 ต้องยืนยัน การแก้ที่นี่ไม่ต้อง deploy ใหม่
          และทุกการแก้บันทึกลง Audit Log พร้อมเหตุผล
        </p>

        <p className="notice">
          การแก้อัตราจ่ายไม่กระทบบิลที่ยืนยันไปแล้ว เพราะแต่ละรายการเก็บอัตราจ่าย
          ของตัวเองไว้ตั้งแต่ตอนยืนยัน ขณะนี้มี {confirmedItems} รายการที่ล็อกอัตราไว้แล้ว
        </p>

        {!canEdit && <p className="muted">บทบาทของคุณดูได้อย่างเดียว</p>}

        <table className="rulebook">
          <thead>
            <tr>
              <th scope="col">รหัส</th>
              <th scope="col" colSpan={7}>
                ชื่อ · จำนวนหลัก · อัตราจ่าย · วงเงินต่อรายการ · โต๊ด · เปิดใช้ · เหตุผล
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
                    isPermutation: p.isPermutation,
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
                    {p.name} · {p.digits} หลัก · จ่าย {p.payoutRate.toFixed(4)} ·{" "}
                    {p.maxStakePerItem === null
                      ? "ไม่จำกัดต่อรายการ"
                      : `สูงสุด ${p.maxStakePerItem.toFixed(2)}`}
                    {p.isPermutation && " · โต๊ด"}
                    {!p.isActive && " · ปิดใช้งาน"}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
