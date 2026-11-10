import Link from "next/link";
import type { Actor } from "@/lib/auth/context";
import { orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { drawDateLabel } from "@/lib/bills/betting";
import { pickCurrentDraw } from "@/lib/bills/draw-scope";
import { capLabel } from "@/lib/draws/number-cap";
import { exposureByStatus, exposureSummary } from "@/lib/draws/number-exposure";
import { DashboardIcon as Icon } from "./DashboardIcon";
import "./number-cap-panel.css";

/** แดชบอร์ดแสดงแค่เลขที่ใกล้เต็มที่สุดชุดเดียว ที่เหลือดูในหน้ารายการเลขเต็ม */
const TOP_NEAR = 8;
const MONEY = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat("th-TH");

/** สรุปเลขเต็ม / ใกล้เต็ม ของงวดปัจจุบัน สำหรับแดชบอร์ด Owner และ Admin */
export async function NumberCapPanel({ actor }: { actor: Actor }) {
  const draws = await prisma.draw.findMany({
    where: orgScope(actor),
    orderBy: { cutoffAt: "desc" },
    take: 12,
    select: { id: true, name: true, status: true, drawDate: true, cutoffAt: true, numberCap: true },
  });
  const draw = pickCurrentDraw(draws, new Date());
  if (!draw) return null;

  const scope = { drawId: draw.id, cap: draw.numberCap, organizationId: actor.organizationId };
  const [summary, near, full] = await Promise.all([
    exposureSummary(prisma, scope),
    exposureByStatus(prisma, scope, "near", TOP_NEAR),
    exposureByStatus(prisma, scope, "full", 1),
  ]);
  const listHref = (status?: string) => `/numbers?drawId=${draw.id}${status ? `&status=${status}` : ""}`;
  const cards = [
    { key: "all", label: "เลขที่มียอด", value: summary.total, href: listHref("all") },
    { key: "near", label: "ใกล้เต็ม", value: summary.near, href: listHref("near") },
    { key: "full", label: "เลขเต็ม", value: summary.full, href: listHref("full") },
  ];

  return (
    <section className="dashboard-panel number-cap-panel" aria-labelledby="number-cap-panel-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">เลขเต็ม · งวด {drawDateLabel(draw)}</p>
          <h2 id="number-cap-panel-heading">สถานะวงเงินต่อเลข</h2>
        </div>
        <Link href={listHref("all")}>ดูทั้งหมด <Icon name="arrow" /></Link>
      </div>
      <p className="number-cap-panel-note">
        เพดานเลขละ <strong>{capLabel(draw.numberCap)}{draw.numberCap ? " บาท" : ""}</strong> รวมทุก Agent · ใกล้เต็ม = เหลือรับได้ไม่เกิน 20%
      </p>
      <div className="number-cap-panel-cards">
        {cards.map((card) => (
          <Link key={card.key} href={card.href} className={`is-${card.key}`}>
            <span>{card.label}</span>
            <strong>{COUNT.format(card.value)}</strong>
          </Link>
        ))}
      </div>
      <h3>ใกล้เต็มที่สุด</h3>
      {near.length === 0 ? (
        <p className="number-cap-panel-empty">
          {draw.numberCap === null ? "งวดนี้ไม่จำกัดเพดานต่อเลข" : summary.total === 0 ? "งวดนี้ยังไม่มียอดแทง" : "ยังไม่มีเลขที่เหลือรับได้ไม่เกิน 20%"}
          {full.length > 0 && <> · <Link href={listHref("full")}>ดูเลขที่เต็มแล้ว</Link></>}
        </p>
      ) : (
        <ol className="number-cap-panel-list">
          {near.map((row) => (
            <li key={`${row.prizeTypeId}:${row.number}`}>
              <div>
                <strong>{row.number}</strong>
                <small>{row.prizeTypeName}</small>
              </div>
              <div className="number-cap-panel-bar" aria-hidden="true"><i style={{ width: `${Math.min(row.percent ?? 0, 100)}%` }} /></div>
              <div className="number-cap-panel-value">
                <b>เหลือ {MONEY.format(Number(row.remaining ?? 0))}</b>
                <small>รับแล้ว {MONEY.format(Number(row.used))} · {(row.percent ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 0 })}%</small>
              </div>
            </li>
          ))}
        </ol>
      )}
      {summary.near > near.length && (
        <Link className="number-cap-panel-more" href={listHref("near")}>
          ดูเลขใกล้เต็มทั้งหมด {COUNT.format(summary.near)} เลข →
        </Link>
      )}
    </section>
  );
}
