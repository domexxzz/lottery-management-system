import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { getAnalyticsData } from "@/lib/analytics/service";
import { prisma } from "@/lib/db";
import { DashboardFilters } from "../DashboardFilters";
import { dashboardDrawLabel, resolveDashboardDrawScope } from "@/lib/dashboard/lottery-draw-filter";
import { reportCategoryLabel } from "@/lib/reports/draw-groups";
import { customerProfileKey } from "@/lib/customers/profile-key";
import "../reports/reports.css";
import "./analytics.css";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INTEGER = new Intl.NumberFormat("th-TH");

function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function bangkokBoundary(value: string | undefined, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}+07:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/*
 * ทุกหน้าในแอปนี้ผูกกับ session ของผู้ใช้ จึงต้องไม่ถูกทำเป็น static
 *
 * นอกจากเรื่องความถูกต้องแล้ว ยังตัดงาน static generation ตอน build ออกด้วย
 * ซึ่งเป็นขั้นที่กินหน่วยความจำจนถูก OOM killer ฆ่าบนเครื่อง build ขนาดเล็ก
 */
export const dynamic = "force-dynamic";

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (actor.role !== "OWNER") redirect("/");

  const query = await searchParams;
  const drawId = first(query.drawId);
  const lottery = first(query.lottery);
  const dateFrom = bangkokBoundary(first(query.dateFrom));
  const dateTo = bangkokBoundary(first(query.dateTo), true);
  const scope = orgScope(actor);

  const physicalDraws = await prisma.draw.findMany({
    where: scope,
    orderBy: { cutoffAt: "desc" },
    select: { id: true, name: true, drawDate: true, cutoffAt: true, status: true, lotteryType: true, laoFamilyId: true },
  });
  const drawScope = resolveDashboardDrawScope(physicalDraws, lottery, drawId);
  const analytics = await getAnalyticsData({
    organizationId: actor.organizationId,
    drawIds: drawScope.drawIds,
    dateFrom,
    dateTo,
  });

  const timeDemand = new Map<string, { bills: number; sales: number }>([["เช้า", { bills: 0, sales: 0 }], ["บ่าย", { bills: 0, sales: 0 }], ["เย็น/ค่ำ", { bills: 0, sales: 0 }]]);
  for (const row of analytics.times) timeDemand.set(row.label, { bills: row.bills, sales: row.sales });

  const customerRows = analytics.customers;
  const totalSales = analytics.totalSales;
  const repeatCustomers = analytics.repeatCustomers;
  // ตัวหารคือลูกค้าที่ระบุชื่อเท่านั้น บิลไม่ระบุชื่อไม่ทำให้อัตราซื้อซ้ำต่ำเกินจริง
  const repeatRate = analytics.customerCount ? repeatCustomers / analytics.customerCount * 100 : 0;
  const averageOrder = analytics.billCount ? totalSales / analytics.billCount : 0;
  const segments = [
    { label: "ลูกค้าประจำ", detail: "ซื้ออย่างน้อย 3 ครั้ง", count: analytics.segments.loyal, color: "#168f91" },
    { label: "ซื้อตามโอกาส", detail: "ซื้อซ้ำ 2 ครั้ง", count: analytics.segments.occasional, color: "#efad3b" },
    { label: "ลูกค้าใหม่", detail: "พบเพียง 1 ครั้ง", count: analytics.segments.new, color: "#7566b1" },
  ];
  const allPrizes = analytics.prizes;
  const maxPrizeStake = Math.max(...allPrizes.map((prize) => prize.stake), 1);
  const maxTimeSales = Math.max(...[...timeDemand.values()].map((value) => value.sales), 1);
  const topDraws = [...analytics.draws].sort((a, b) => b.sales - a.sales).slice(0, 5);
  // เลขที่รับยอดสูงสุด 5 อันดับจากทุกประเภท ส่วนรายประเภทพับไว้ใน "ดูทั้งหมด"
  const topNumbers = analytics.prizeNumbers.slice(0, 5);
  const numbersByPrize = allPrizes
    .map((prize) => ({ ...prize, numbers: analytics.prizeNumbers.filter((row) => row.prizeTypeId === prize.id) }))
    .filter((prize) => prize.numbers.length > 0);
  const insights = buildInsights({
    totalSales,
    namedSales: analytics.namedSales,
    customers: customerRows,
    customerCount: analytics.customerCount,
    repeatRate,
    times: [...timeDemand.entries()],
    topNumber: topNumbers[0],
  });

  return <main className="analytics-page">
    <header className="analytics-hero">
      <div><Link href="/" className="back-link">← กลับหน้าภาพรวม</Link><p className="eyebrow">Lottery Customer Intelligence</p><h1>วิเคราะห์พฤติกรรมลูกค้าเชิงลึก</h1><p>เข้าใจว่าลูกค้าซื้ออะไร ซื้อเมื่อไร ซื้อบ่อยแค่ไหน และกลุ่มใดสร้างยอดขายหลัก</p></div>
      <div className="data-badge"><span>●</span><div><strong>ข้อมูลจริงจากระบบ</strong><small>{INTEGER.format(analytics.billCount)} บิลที่ยืนยันแล้ว</small></div></div>
    </header>

    <DashboardFilters
      draws={drawScope.logicalDraws.map((draw) => ({
        id: draw.id,
        label: `${reportCategoryLabel(draw.category)} · ${dashboardDrawLabel(draw)}`,
        lotteryType: draw.lotteryType,
        category: draw.category,
        status: draw.status,
      }))}
      category={drawScope.category}
      selectedDrawId={drawScope.selectedDraw?.id}
    />

    {insights.length > 0 && (
      <section className="analytics-insights" aria-labelledby="analytics-insights-heading">
        <h2 id="analytics-insights-heading">{insights.length} เรื่องที่ควรรู้ตอนนี้</h2>
        <ol>
          {insights.map((insight) => (
            <li key={insight.key}>
              <strong>{insight.title}</strong>
              <p>{insight.action}</p>
            </li>
          ))}
        </ol>
      </section>
    )}

    <section className="analytics-kpis" aria-label="ตัวเลขสำคัญ">
      <article><span>ยอดขายรวม</span><strong>{MONEY.format(totalSales)} ฿</strong><small>บิลที่ยืนยัน ล็อก หรือคำนวณแล้ว</small></article>
      <article><span>ลูกค้าทั้งหมด</span><strong>{INTEGER.format(analytics.customerCount)}</strong><small>นับตาม Agent + ชื่อลูกค้า{analytics.unknownBills > 0 ? ` · ไม่ระบุชื่อ ${INTEGER.format(analytics.unknownBills)} บิล` : ""}</small></article>
      <article><span>ลูกค้าซื้อซ้ำ</span><strong>{repeatRate.toFixed(1)}%</strong><small>{INTEGER.format(repeatCustomers)} คนที่ซื้อเกิน 1 ครั้ง</small></article>
      <article><span>ยอดซื้อเฉลี่ย</span><strong>{MONEY.format(averageOrder)} ฿</strong><small>ต่อหนึ่งบิล</small></article>
    </section>

    <section className="analytics-grid analytics-grid-main">
      <article className="analytics-card segment-card"><header><div><p className="eyebrow">Customer Segmentation</p><h2>สัดส่วนพฤติกรรมลูกค้า</h2></div></header><div className="segment-list">{segments.map((segment) => { const percent = analytics.customerCount ? segment.count / analytics.customerCount * 100 : 0; return <div key={segment.label} className="segment-row"><span className="segment-dot" style={{ background: segment.color }}/><div><strong>{segment.label}</strong><small>{segment.detail}</small><span className="segment-track"><i style={{ width: `${percent}%`, background: segment.color }}/></span></div><b>{segment.count}<small>{percent.toFixed(1)}%</small></b></div>; })}</div>{analytics.unknownBills > 0 && <p className="card-insight">บิลที่ไม่ระบุชื่อลูกค้า {INTEGER.format(analytics.unknownBills)} บิล ไม่นับรวมในสัดส่วนนี้</p>}</article>
      <article className="analytics-card"><header><div><p className="eyebrow">Purchase Time</p><h2>ช่วงเวลาที่ลูกค้าซื้อ</h2></div></header><div className="time-bars">{[...timeDemand.entries()].map(([label, value]) => <div key={label}><div><strong>{label}</strong><span>{value.bills} บิล · {MONEY.format(value.sales)} ฿</span></div><span><i style={{ width: `${value.sales / maxTimeSales * 100}%` }}/></span></div>)}</div><p className="card-insight">ช่วงที่มียอดขายสูงสุด: <strong>{[...timeDemand.entries()].sort((a, b) => b[1].sales - a[1].sales)[0]?.[0] ?? "ยังไม่มีข้อมูล"}</strong></p></article>
    </section>

    <section className="analytics-grid analytics-grid-detail">
      <article className="analytics-card number-demand-card">
        <header><div><p className="eyebrow">Number Demand</p><h2>เลขที่รับยอดสูงสุด</h2><small className="ranking-basis">5 อันดับจากทุกประเภท เรียงจากยอดรับ</small></div><span className="neutral-chip">ไม่ใช่การทำนายผล</span></header>
        {topNumbers.length === 0 ? <p className="empty-state">ยังไม่มีข้อมูล</p> : (
          <>
            <ol className="top-number-list">
              {topNumbers.map((row, index) => (
                <li key={`${row.prizeTypeId}:${row.number}`}>
                  <b>{index + 1}</b>
                  <strong>{row.number}</strong>
                  <span>{row.prizeLabel}<small>{INTEGER.format(row.count)} รายการ</small></span>
                  <em>{MONEY.format(row.stake)} ฿</em>
                </li>
              ))}
            </ol>
            {numbersByPrize.length > 0 && (
              <details className="number-groups-more">
                <summary>ดูทั้งหมดแยกตามประเภทการแทง ({numbersByPrize.length} ประเภท)</summary>
                <div className="number-groups">{numbersByPrize.map((group, groupIndex) => <section key={group.id} className="number-group"><header><span>{groupIndex + 1}</span><strong>{group.label}</strong><small>เลขยอดนิยม {group.numbers.length} อันดับ</small></header><div className="number-grid">{group.numbers.map((row, index) => <div key={row.number}><b>{index + 1}</b><strong>{row.number}</strong><span>{row.count} รายการ</span><small>{MONEY.format(row.stake)} ฿</small></div>)}</div></section>)}</div>
              </details>
            )}
          </>
        )}
      </article>
      <article className="analytics-card"><header><div><p className="eyebrow">Prize Type Preference · All</p><h2>ประเภทรางวัลที่นิยมทั้งหมด</h2><small className="ranking-basis">แยกตามประเภทหวย เรียงจากยอดเดิมพันรวม</small></div></header>{allPrizes.length === 0 ? <p className="empty-state">ยังไม่มีข้อมูล</p> : <div className="prize-bars">{allPrizes.map((prize, index) => <div key={prize.id}><div><span className="prize-rank">{index + 1}</span><strong>{prize.label}</strong><span>{prize.count} รายการ</span></div><span><i style={{ width: `${prize.stake / maxPrizeStake * 100}%` }}/></span><small>{MONEY.format(prize.stake)} ฿</small></div>)}</div>}</article>
    </section>

    <section className="analytics-grid analytics-grid-bottom">
      <article className="analytics-card customer-table-card"><header><div><p className="eyebrow">Customer Frequency & Budget</p><h2>ลูกค้ามูลค่าสูงและการซื้อซ้ำ</h2><small className="ranking-basis">กดชื่อลูกค้าเพื่อดูบิล งวด Agent และเลขที่เล่นบ่อย</small></div></header><div className="analytics-table-wrap"><table><thead><tr><th>ลูกค้า · Agent</th><th className="num">จำนวนครั้ง</th><th className="num">รายการ</th><th className="num">ยอดซื้อรวม</th><th className="num">เฉลี่ย/ครั้ง</th></tr></thead><tbody>{customerRows.slice(0, 10).map((customer) => <tr key={customer.label}><td><Link href={`/customers/${customerProfileKey(customer.name)}`}><strong>{customer.name}</strong></Link> <small>{customer.agentCode}</small></td><td className="num">{customer.bills}</td><td className="num">{customer.items}</td><td className="num">{MONEY.format(customer.spend)}</td><td className="num">{MONEY.format(customer.spend / customer.bills)}</td></tr>)}</tbody></table></div></article>
      <article className="analytics-card"><header><div><p className="eyebrow">Draw Performance</p><h2>งวดที่มีความต้องการสูง</h2></div></header><ol className="draw-ranking">{topDraws.map((row, index) => <li key={row.id}><b>{index + 1}</b><div><strong>{row.name}</strong><small>{row.bills} บิล</small></div><span>{MONEY.format(row.sales)} ฿</span></li>)}</ol></article>
    </section>

    <section className="analytics-note"><strong>ข้อควรเข้าใจเกี่ยวกับข้อมูล</strong><p>ระบบนับลูกค้าจาก Agent + ชื่อลูกค้าในบิล (ตัดช่องว่างเกินและคำว่า &ldquo;คุณ&rdquo; นำหน้า) ชื่อที่สะกดต่างกันยังนับเป็นคนละคน จึงควรใช้ชื่อหรือรหัสที่สม่ำเสมอ เช่น C001 ตัวเลขที่ขายดีสะท้อนความต้องการเท่านั้น ไม่ได้มีโอกาสถูกรางวัลมากกว่าเลขอื่น</p></section>
  </main>;
}

type Insight = { key: string; title: string; action: string };

/**
 * สรุปสิ่งที่ควรรู้จากตัวเลขบนหน้า เลือกเรื่องที่เด่นที่สุดไม่เกิน 3 เรื่อง
 * ใช้เกณฑ์ง่าย ๆ ที่อธิบายได้ ไม่ใช่การทำนาย
 */
function buildInsights(input: {
  totalSales: number;
  namedSales: number;
  customers: { name: string; agentCode: string; spend: number }[];
  customerCount: number;
  repeatRate: number;
  times: [string, { bills: number; sales: number }][];
  topNumber: { number: string; prizeLabel: string; stake: number } | undefined;
}): Insight[] {
  if (input.totalSales <= 0) return [];
  const insights: (Insight & { weight: number })[] = [];
  const percent = (value: number) => `${(value * 100).toFixed(0)}%`;

  const topTwo = input.customers.slice(0, 2);
  if (input.customerCount >= 3 && input.namedSales > 0) {
    const share = topTwo.reduce((sum, row) => sum + row.spend, 0) / input.namedSales;
    if (share >= 0.4) {
      insights.push({
        key: "concentration",
        weight: share,
        title: `ลูกค้า 2 อันดับแรกสร้างยอดขาย ${percent(share)}`,
        action: `${topTwo.map((row) => `${row.name} (${row.agentCode})`).join(" และ ")} — ยอดพึ่งพาคนกลุ่มเล็ก ควรดูแลลูกค้ากลุ่มนี้และหาลูกค้าใหม่เพิ่ม`,
      });
    }
  }

  const peak = [...input.times].sort((a, b) => b[1].sales - a[1].sales)[0];
  if (peak && peak[1].sales > 0) {
    const share = peak[1].sales / input.totalSales;
    if (share >= 0.5) {
      insights.push({
        key: "peak-time",
        weight: share,
        title: `ยอดขาย ${percent(share)} เกิดช่วง${peak[0]}`,
        action: `ให้ Agent พร้อมรับบิลช่วง${peak[0]} และตรวจเลขเต็ม/เลขอั้นก่อนช่วงนี้`,
      });
    }
  }

  if (input.customerCount >= 5) {
    const low = input.repeatRate < 30;
    insights.push({
      key: "repeat",
      weight: low ? 0.6 : 0.3,
      title: low ? `ลูกค้าซื้อซ้ำเพียง ${input.repeatRate.toFixed(1)}%` : `ลูกค้าซื้อซ้ำ ${input.repeatRate.toFixed(1)}%`,
      action: low ? "ลูกค้าส่วนใหญ่ซื้อครั้งเดียว ลองให้ Agent ติดต่อลูกค้าเดิมก่อนปิดรับงวดถัดไป" : "ฐานลูกค้าประจำดี รักษาการติดต่อกับลูกค้ากลุ่มนี้ต่อ",
    });
  }

  if (input.topNumber) {
    const share = input.topNumber.stake / input.totalSales;
    insights.push({
      key: "top-number",
      weight: 0.5 + share,
      title: `เลข ${input.topNumber.number} รับยอดสูงสุด ${MONEY.format(input.topNumber.stake)} บาท`,
      action: `${input.topNumber.prizeLabel} · คิดเป็น ${percent(share)} ของยอดขาย ตรวจความเสี่ยงหากเลขนี้ออก และพิจารณาตั้งเพดานหรือเลขอั้น`,
    });
  }

  return insights.sort((a, b) => b.weight - a.weight).slice(0, 3).map(({ key, title, action }) => ({ key, title, action }));
}
