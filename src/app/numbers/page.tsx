import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { drawDateLabel } from "@/lib/bills/betting";
import { pickCurrentDraw } from "@/lib/bills/draw-scope";
import { capLabel } from "@/lib/draws/number-cap";
import { exposureSummary, listExposure, type ExposureSort, type ExposureStatus } from "@/lib/draws/number-exposure";
import { DEFAULT_DIRECTION, exposureHref, pageWindow, parseExposureParams } from "@/lib/draws/exposure-query";
import "./numbers.css";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 5;
const MONEY = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat("th-TH");
const CUTOFF = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

const STATUS_LABEL: Record<ExposureStatus, string> = {
  normal: "ปกติ",
  near: "ใกล้เต็ม",
  full: "เต็ม",
};

const SORT_LABEL: Record<ExposureSort, string> = {
  percent: "ใช้วงเงิน (%) มากสุด",
  used: "ยอดรับมากสุด",
  remaining: "คงเหลือน้อยสุด",
  number: "เลข",
};

/**
 * หน้ารายการเลขเต็ม / ใกล้เต็ม ของทั้งงวด
 *
 * ยอดทุกตัวเลขรวมในฐานข้อมูล (GROUP BY ประเภทรางวัล + เลข) แล้วกรอง เรียง และแบ่งหน้าฝั่ง Server
 * หน้าแรกเน้น 5 เลขที่ต้องเฝ้าระวังตามแบบ และแบ่งหน้าฝั่ง Server จึงรับได้แม้มีหลายพันเลข
 */
export default async function NumbersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "report.viewAllAgents")) redirect("/bills");

  const params = parseExposureParams(await searchParams);
  const [draws, prizeTypes] = await Promise.all([
    prisma.draw.findMany({
      where: orgScope(actor),
      orderBy: { cutoffAt: "desc" },
      take: 24,
      select: { id: true, name: true, status: true, drawDate: true, cutoffAt: true, numberCap: true },
    }),
    prisma.prizeType.findMany({
      where: { ...orgScope(actor), isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const draw = draws.find((row) => row.id === params.drawId) ?? pickCurrentDraw(draws, new Date()) ?? draws[0] ?? null;

  if (!draw) {
    return (
      <main className="workspace-page numbers-page">
        <header className="numbers-head"><div><p className="page-eyebrow">Number Exposure</p><h1>สถานะเลขเต็ม</h1></div></header>
        <p className="numbers-empty">ยังไม่มีงวดในระบบ</p>
      </main>
    );
  }

  const current = { ...params, drawId: draw.id };
  const scope = { drawId: draw.id, cap: draw.numberCap, organizationId: actor.organizationId };
  const typeId = prizeTypes.some((prizeType) => prizeType.id === params.type) ? params.type : "";
  const [summary, list] = await Promise.all([
    exposureSummary(prisma, scope),
    listExposure(prisma, scope, {
      status: params.status,
      prizeTypeId: typeId || undefined,
      search: params.q,
      sort: params.sort,
      direction: params.dir,
      page: params.page,
      pageSize: PAGE_SIZE,
    }),
  ]);
  const cards: { status: ExposureStatus | "all"; label: string; value: number; hint: string; icon: string }[] = [
    { status: "all", label: "เลขที่มียอดทั้งหมด", value: summary.total, hint: "รวมทุกประเภทการแทง", icon: "#" },
    { status: "near", label: "เลขใกล้เต็ม", value: summary.near, hint: "เหลือรับได้ไม่เกิน 20%", icon: "!" },
    { status: "full", label: "เลขเต็ม", value: summary.full, hint: draw.numberCap === null ? "งวดนี้ไม่จำกัดเพดาน" : `รับครบ ${capLabel(draw.numberCap)} บาทแล้ว`, icon: "✓" },
  ];

  const sortHeader = (sort: ExposureSort, label: string) => {
    const active = params.sort === sort;
    const dir = active ? (params.dir === "asc" ? "desc" : "asc") : DEFAULT_DIRECTION[sort];
    return (
      <Link href={exposureHref(current, { sort, dir })} className={active ? "is-active" : undefined} aria-label={`เรียงตาม${label}`}>
        {label}
        <span aria-hidden="true">{active ? (params.dir === "asc" ? " ▲" : " ▼") : " ↕"}</span>
      </Link>
    );
  };

  return (
    <main className="workspace-page numbers-page">
      <header className="numbers-announcement">
        <span className="numbers-announcement-icon" aria-hidden="true">!</span>
        <div>
          <p className="page-eyebrow">Number Exposure</p>
          <h1>ประกาศเลขเต็ม</h1>
          <p>เลขเต็มปิดรับแล้ว แทงเลขนั้นไม่ได้ · เลขใกล้เต็มเหลือรับได้ไม่เกิน 20%</p>
        </div>
        <div className="numbers-announcement-meta">
          <span aria-hidden="true">▣</span>
          <strong>{drawDateLabel(draw)}</strong>
          <i>·</i>
          <span>ปิดรับ {CUTOFF.format(draw.cutoffAt)}</span>
        </div>
      </header>

      <section className="numbers-cards" aria-label="สรุปจำนวนเลข">
        {cards.map((card) => (
          <Link
            key={card.status}
            href={exposureHref(current, { status: card.status })}
            className={`numbers-card is-${card.status}`}
            aria-current={params.status === card.status ? "page" : undefined}
          >
            <b className="numbers-card-icon" aria-hidden="true">{card.icon}</b>
            <span>{card.label}</span>
            <strong>{COUNT.format(card.value)}</strong>
            <small>{card.hint}</small>
          </Link>
        ))}
      </section>

      <section className="numbers-watch-heading" aria-labelledby="numbers-watch-title">
        <div className="numbers-watch-title">
          <span aria-hidden="true">!</span>
          <div>
            <h2 id="numbers-watch-title">เลขที่ต้องเฝ้าระวัง</h2>
            <p>ตรวจยอดคงเหลือของเลขใกล้เต็มและเลขเต็มจากข้อมูลบิลจริง</p>
          </div>
        </div>
        <nav className="numbers-status-tabs" aria-label="เลือกสถานะเลข">
          <Link href={exposureHref(current, { status: "near" })} aria-current={params.status === "near" ? "page" : undefined}>เลขใกล้เต็ม ({COUNT.format(summary.near)})</Link>
          <Link href={exposureHref(current, { status: "full" })} aria-current={params.status === "full" ? "page" : undefined}>เลขเต็ม ({COUNT.format(summary.full)})</Link>
          <Link href={exposureHref(current, { status: "all" })} aria-current={params.status === "all" || params.status === "normal" ? "page" : undefined}>ดูเลขทั้งหมด</Link>
        </nav>
      </section>

      <form className="numbers-filters" action="/numbers" method="get">
        {params.status !== "all" && <input type="hidden" name="status" value={params.status} />}
        <label>
          งวด
          <select name="drawId" defaultValue={draw.id}>
            {draws.map((row) => <option key={row.id} value={row.id}>งวด {drawDateLabel(row)}</option>)}
          </select>
        </label>
        <label>
          ประเภทการแทง
          <select name="type" defaultValue={typeId}>
            <option value="">ทุกประเภท</option>
            {prizeTypes.map((prizeType) => <option key={prizeType.id} value={prizeType.id}>{prizeType.name}</option>)}
          </select>
        </label>
        <label>
          ค้นหาเลข
          <input name="q" inputMode="numeric" pattern="\d*" maxLength={6} defaultValue={params.q} placeholder="เช่น 123" />
        </label>
        <label>
          เรียงตาม
          <select name="sort" defaultValue={params.sort}>
            {(Object.keys(SORT_LABEL) as ExposureSort[]).map((sort) => <option key={sort} value={sort}>{SORT_LABEL[sort]}</option>)}
          </select>
        </label>
        <div className="numbers-filter-actions">
          <button type="submit">ค้นหา</button>
          <Link href={exposureHref({ ...current, status: "all", type: "", q: "", sort: "percent", dir: "desc", page: 1 }, {})}>ล้างตัวกรอง</Link>
        </div>
      </form>

      <section className="numbers-list" aria-labelledby="numbers-list-heading">
        <header>
          <h2 id="numbers-list-heading">
            {params.status === "all" ? "เลขทั้งหมด" : params.status === "normal" ? "เลขสถานะปกติ" : `เลข${STATUS_LABEL[params.status]}`}
          </h2>
          <span>
            พบ {COUNT.format(list.total)} เลข
            {list.total > 0 && ` · แสดง ${COUNT.format((list.page - 1) * list.pageSize + 1)}–${COUNT.format(Math.min(list.page * list.pageSize, list.total))}`}
          </span>
        </header>

        {list.rows.length === 0 ? (
          <p className="numbers-empty">{summary.total === 0 ? "งวดนี้ยังไม่มียอดแทง" : "ไม่พบเลขตามเงื่อนไขนี้"}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">{sortHeader("number", "เลข")}</th>
                <th scope="col">ประเภท</th>
                <th scope="col" className="num">{sortHeader("used", "ยอดรับ")}</th>
                <th scope="col" className="num">วงเงินสูงสุด</th>
                <th scope="col" className="num">{sortHeader("remaining", "คงเหลือ")}</th>
                <th scope="col">{sortHeader("percent", "ใช้วงเงิน")}</th>
                <th scope="col">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr key={`${row.prizeTypeId}:${row.number}`} className={`is-${row.status}`}>
                  <td data-label="เลข"><strong className="numbers-number">{row.number}</strong>{row.isPermutation && <small>รวมเลขสลับหลัก</small>}</td>
                  <td data-label="ประเภท">{row.prizeTypeName}<small>{COUNT.format(row.itemCount)} รายการ</small></td>
                  <td data-label="ยอดรับ" className="num">{MONEY.format(Number(row.used))}</td>
                  <td data-label="วงเงินสูงสุด" className="num">{capLabel(draw.numberCap)}</td>
                  <td data-label="คงเหลือ" className="num"><b>{row.remaining === null ? "ไม่จำกัด" : `${MONEY.format(Math.max(Number(row.remaining), 0))} บาท`}</b></td>
                  <td data-label="ใช้วงเงิน">
                    {row.percent === null ? (
                      <span className="numbers-muted">-</span>
                    ) : (
                      <div className="numbers-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(row.percent, 100)} aria-label={`ใช้วงเงิน ${row.percent}%`}>
                        <span><i style={{ width: `${Math.min(row.percent, 100)}%` }} /></span>
                        <em>{row.percent.toLocaleString("th-TH", { maximumFractionDigits: 1 })}%</em>
                      </div>
                    )}
                  </td>
                  <td data-label="สถานะ"><span className={`numbers-chip is-${row.status}`}>{STATUS_LABEL[row.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {list.pageCount > 1 && (
          <nav className="numbers-pagination" aria-label="เปลี่ยนหน้า">
            {list.page > 1 ? <Link href={exposureHref(current, { page: list.page - 1 })}>‹ ก่อนหน้า</Link> : <span className="is-disabled">‹ ก่อนหน้า</span>}
            {pageWindow(list.page, list.pageCount).map((value, index) => value === "gap"
              ? <span key={`gap-${index}`} className="is-gap">…</span>
              : <Link key={value} href={exposureHref(current, { page: value })} aria-current={value === list.page ? "page" : undefined}>{value}</Link>)}
            {list.page < list.pageCount ? <Link href={exposureHref(current, { page: list.page + 1 })}>ถัดไป ›</Link> : <span className="is-disabled">ถัดไป ›</span>}
          </nav>
        )}
      </section>
    </main>
  );
}
