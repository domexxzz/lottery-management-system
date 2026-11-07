import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { getBill } from "@/lib/bills/service";
import { statusLabel } from "@/lib/bills/lifecycle";
import { NotFoundError } from "@/lib/errors";
import "./print.css";

export const dynamic = "force-dynamic";

const BANGKOK = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

/**
 * หน้าพิมพ์บิล
 *
 * ?format=slip ให้กระดาษแคบสำหรับเครื่องพิมพ์สลิป ค่าเริ่มต้นเป็น A4
 * ขนาดกระดาษคุมด้วย @page ใน print.css ไม่ได้คุมด้วย JavaScript
 */
export default async function PrintBillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ format?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const [{ id }, { format }] = await Promise.all([params, searchParams]);
  const isSlip = format === "slip";

  let bill;
  try {
    bill = await getBill(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className={isSlip ? "sheet sheet-slip" : "sheet sheet-a4"}>
      <header className="sheet-header">
        <h1>บิลรับรายการ</h1>
        <p className="sheet-number">เลขบิล {bill.billNumber ?? "(ร่าง ยังไม่ออกเลข)"}</p>
      </header>

      <dl className="sheet-meta">
        <div>
          <dt>ชื่อบิล</dt>
          <dd>{bill.title}</dd>
        </div>
        <div>
          <dt>งวด</dt>
          <dd>{bill.draw.name}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd>
            {bill.agent.code} {bill.agent.name}
          </dd>
        </div>
        <div>
          <dt>สถานะ</dt>
          <dd>{statusLabel(bill.status)}</dd>
        </div>
        <div>
          <dt>เวลายืนยัน</dt>
          <dd>{bill.confirmedAt === null ? "-" : BANGKOK.format(bill.confirmedAt)}</dd>
        </div>
        <div>
          <dt>ปิดรับ</dt>
          <dd>{BANGKOK.format(bill.draw.cutoffAt)}</dd>
        </div>
      </dl>

      <table className="sheet-items">
        <thead>
          <tr>
            <th scope="col">รางวัล</th>
            <th scope="col">เลข</th>
            <th scope="col" className="num">
              ยอด
            </th>
            {!isSlip && (
              <th scope="col" className="num">
                อัตราจ่าย
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {bill.items.map((item) => (
            <tr key={item.id}>
              <td>
                {item.prizeType.code}. {item.prizeType.name}
              </td>
              <td className="number-cell">{item.number}</td>
              <td className="num">{item.stake.toFixed(2)}</td>
              {!isSlip && <td className="num">{item.payoutRateSnapshot.toFixed(4)}</td>}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2}>
              ยอดรวม
            </th>
            <td className="num">{bill.totalStake.toFixed(2)}</td>
            {!isSlip && <td />}
          </tr>
        </tfoot>
      </table>

      {bill.status === "CANCELLED" && (
        <p className="sheet-void">ยกเลิก · {bill.cancelReason}</p>
      )}

      <footer className="sheet-footer">
        <p>
          พิมพ์เมื่อ {BANGKOK.format(new Date())} · ผู้พิมพ์ {actor.displayName}
        </p>
        <p className="no-print">
          <button type="button" data-print-trigger>
            สั่งพิมพ์
          </button>
        </p>
      </footer>

      {/* ปุ่มพิมพ์ต้องใช้ API ของเบราว์เซอร์ จึงแนบสคริปต์สั้น ๆ แทนการทำทั้งหน้าเป็น client component */}
      <script
        dangerouslySetInnerHTML={{
          __html: `document.querySelector('[data-print-trigger]')?.addEventListener('click',()=>window.print())`,
        }}
      />
    </div>
  );
}
