import Link from "next/link";
import { redirect } from "next/navigation";
import type { BillStatus } from "@prisma/client";
import { getActor, orgScope } from "@/lib/auth/context";
import { getAnalyticsData } from "@/lib/analytics/service";
import { customerProfileKey } from "@/lib/customers/profile-key";
import { prisma } from "@/lib/db";
import { AnalyticsFilters } from "./AnalyticsFilters";
import { ReportChart } from "../reports/ReportChart";
import "../reports/reports.css";
import "./analytics.css";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INTEGER = new Intl.NumberFormat("th-TH");

const ANALYTICS_STATUSES: BillStatus[] = ["CONFIRMED", "LOCKED", "SETTLED"];
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

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
  const agentId = first(query.agentId);
  const rawStatus = first(query.status);
  const selectedStatus = ANALYTICS_STATUSES.includes(rawStatus as BillStatus) ? rawStatus as BillStatus : undefined;
  const scope = orgScope(actor);

  const [analytics, draws, agents] = await Promise.all([
    getAnalyticsData({ organizationId: actor.organizationId, drawId, agentId, status: selectedStatus }),
    prisma.draw.findMany({ where: scope, orderBy: { cutoffAt: "desc" }, select: { id: true, name: true } }),
    prisma.agent.findMany({ where: scope, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);

  const timeDemand = new Map<string, { bills: number; sales: number }>([["เช้า", { bills: 0, sales: 0 }], ["บ่าย", { bills: 0, sales: 0 }], ["เย็น/ค่ำ", { bills: 0, sales: 0 }]]);
  for (const row of analytics.times) timeDemand.set(row.label, { bills: row.bills, sales: row.sales });

  const customerRows = analytics.customers;
  const totalSales = analytics.totalSales;
  const repeatCustomers = analytics.repeatCustomers;
  const repeatRate = analytics.customerCount ? repeatCustomers / analytics.customerCount * 100 : 0;
  const averageOrder = analytics.billCount ? totalSales / analytics.billCount : 0;
  const segments = [
    { label: "ลูกค้าประจำ", detail: "ซื้ออย่างน้อย 3 ครั้ง", count: analytics.segments.loyal, color: "#168f91" },
    { label: "ซื้อตามโอกาส", detail: "ซื้อซ้ำ 2 ครั้ง", count: analytics.segments.occasional, color: "#efad3b" },
    { label: "ลูกค้าใหม่", detail: "พบเพียง 1 ครั้ง", count: analytics.segments.new, color: "#7566b1" },
    { label: "ไม่ระบุรหัส", detail: "ยังเชื่อมลูกค้าไม่ได้", count: analytics.segments.unknown, color: "#9aa8b1" },
  ];
  const allPrizes = analytics.prizes.map((row) => [row.name, { count: row.count, stake: row.stake }] as const);
  const topPrizeNumberGroups = allPrizes.slice(0, 5).map(([name]) => ({
    name,
    numbers: analytics.prizeNumbers
      .filter((row) => row.prizeName === name)
      .map((row) => [row.number, { count: row.count, stake: row.stake }] as const),
  }));
  const maxPrizeStake = Math.max(...allPrizes.map(([, value]) => value.stake), 1);
  const maxTimeSales = Math.max(...[...timeDemand.values()].map((value) => value.sales), 1);
  const topDraws = [...analytics.draws].sort((a, b) => b.sales - a.sales).slice(0, 5);

  return <main className="analytics-page">
    <header className="analytics-hero">
      <div><Link href="/" className="back-link">← กลับหน้าภาพรวม</Link><p className="eyebrow">Lottery Customer Intelligence</p><h1>วิเคราะห์พฤติกรรมลูกค้าเชิงลึก</h1><p>เข้าใจว่าลูกค้าซื้ออะไร ซื้อเมื่อไร ซื้อบ่อยแค่ไหน และกลุ่มใดสร้างยอดขายหลัก</p></div>
      <div className="data-badge"><span>●</span><div><strong>ข้อมูลจริงจากระบบ</strong><small>{INTEGER.format(analytics.billCount)} บิลที่ยืนยันแล้ว</small></div></div>
    </header>

    <AnalyticsFilters draws={draws.map((draw) => ({ id: draw.id, label: draw.name }))} agents={agents.map((agent) => ({ id: agent.id, label: `${agent.code} · ${agent.name}` }))} />

    <section className="analytics-kpis" aria-label="ตัวเลขสำคัญ">
      <article><span>ยอดขายรวม</span><strong>{MONEY.format(totalSales)} ฿</strong><small>บิลที่ยืนยัน ล็อก หรือคำนวณแล้ว</small></article>
      <article><span>ลูกค้าทั้งหมด</span><strong>{INTEGER.format(analytics.customerCount)}</strong><small>อ้างอิงจากชื่อบิล/รหัสลูกค้า</small></article>
      <article><span>ลูกค้าซื้อซ้ำ</span><strong>{repeatRate.toFixed(1)}%</strong><small>{INTEGER.format(repeatCustomers)} รหัสที่ซื้อเกิน 1 ครั้ง</small></article>
      <article><span>ยอดซื้อเฉลี่ย</span><strong>{MONEY.format(averageOrder)} ฿</strong><small>ต่อหนึ่งบิล</small></article>
    </section>

    <ReportChart
      initialDimension="customers"
      variant="customer-behavior"
      datasets={[
        {
          key: "customers",
          label: "ลูกค้าและความถี่การซื้อ",
          description: "ดูว่าลูกค้าคนใดซื้อบ่อย ใช้จ่ายสูง และเลือกเลขมาก",
          metrics: ["gross", "bills", "items"],
          rows: customerRows.slice(0, 50).map((customer, index) => ({
            id: `${customer.label}-${index}`,
            code: customer.label,
            name: customer.label,
            href: `/customers/${customerProfileKey(customer.label)}`,
            gross: customer.spend,
            payout: 0,
            commission: 0,
            net: customer.spend,
            bills: customer.bills,
            items: customer.items,
            winners: 0,
          })),
        },
        {
          key: "prizes",
          label: "ความสนใจประเภทรางวัล",
          description: "ดูว่าลูกค้าสนใจรางวัลประเภทใดจากยอดซื้อและจำนวนเลขที่เลือก",
          metrics: ["gross", "items"],
          rows: allPrizes.map(([name, value], index) => ({
            id: `${name}-${index}`,
            code: `${index + 1}`,
            name,
            gross: value.stake,
            payout: 0,
            commission: 0,
            net: value.stake,
            bills: 0,
            items: value.count,
            winners: 0,
          })),
        },
        {
          key: "time",
          label: "ช่วงเวลาที่ลูกค้าซื้อ",
          description: "เปรียบเทียบมูลค่าและความถี่การซื้อระหว่างเช้า บ่าย และเย็น",
          metrics: ["gross", "bills"],
          rows: [...timeDemand.entries()].map(([label, value]) => ({
            id: label,
            code: label,
            name: `ช่วง${label}`,
            gross: value.sales,
            payout: 0,
            commission: 0,
            net: value.sales,
            bills: value.bills,
            items: 0,
            winners: 0,
          })),
        },
        {
          key: "draws",
          label: "แนวโน้มพฤติกรรมรายงวด",
          description: "ดูการเปลี่ยนแปลงของยอดซื้อและความถี่การซื้อในแต่ละงวด",
          metrics: ["gross", "bills"],
          rows: analytics.draws.map((row) => ({
            id: row.id,
            code: row.name,
            name: row.name,
            gross: row.sales,
            payout: 0,
            commission: 0,
            net: row.sales,
            bills: row.bills,
            items: 0,
            winners: 0,
          })),
        },
      ]}
    />

    <section className="analytics-grid analytics-grid-main">
      <article className="analytics-card segment-card"><header><div><p className="eyebrow">Customer Segmentation</p><h2>สัดส่วนพฤติกรรมลูกค้า</h2></div></header><div className="segment-list">{segments.map((segment) => { const percent = analytics.customerCount ? segment.count / analytics.customerCount * 100 : 0; return <div key={segment.label} className="segment-row"><span className="segment-dot" style={{ background: segment.color }}/><div><strong>{segment.label}</strong><small>{segment.detail}</small><span className="segment-track"><i style={{ width: `${percent}%`, background: segment.color }}/></span></div><b>{segment.count}<small>{percent.toFixed(1)}%</small></b></div>; })}</div></article>
      <article className="analytics-card"><header><div><p className="eyebrow">Purchase Time</p><h2>ช่วงเวลาที่ลูกค้าซื้อ</h2></div></header><div className="time-bars">{[...timeDemand.entries()].map(([label, value]) => <div key={label}><div><strong>{label}</strong><span>{value.bills} บิล · {MONEY.format(value.sales)} ฿</span></div><span><i style={{ width: `${value.sales / maxTimeSales * 100}%` }}/></span></div>)}</div><p className="card-insight">ช่วงที่มียอดขายสูงสุด: <strong>{[...timeDemand.entries()].sort((a, b) => b[1].sales - a[1].sales)[0]?.[0] ?? "ยังไม่มีข้อมูล"}</strong></p></article>
    </section>

    <section className="analytics-grid analytics-grid-detail">
      <article className="analytics-card number-demand-card"><header><div><p className="eyebrow">Number Demand by Prize Type</p><h2>เลขที่มีความต้องการสูง</h2><small className="ranking-basis">แยกเลขยอดนิยม 3 อันดับ ภายใน 5 ประเภทรางวัลยอดนิยม</small></div><span className="neutral-chip">ไม่ใช่การทำนายผล</span></header>{topPrizeNumberGroups.length === 0 ? <p className="empty-state">ยังไม่มีข้อมูล</p> : <div className="number-groups">{topPrizeNumberGroups.map((group, groupIndex) => <section key={group.name} className="number-group"><header><span>{groupIndex + 1}</span><strong>{group.name}</strong><small>เลขยอดนิยม 3 อันดับ</small></header><div className="number-grid">{group.numbers.map(([number, value], index) => <div key={number}><b>{index + 1}</b><strong>{number}</strong><span>{value.count} รายการ</span><small>{MONEY.format(value.stake)} ฿</small></div>)}</div></section>)}</div>}</article>
      <article className="analytics-card"><header><div><p className="eyebrow">Prize Type Preference · All</p><h2>ประเภทรางวัลที่นิยมทั้งหมด</h2><small className="ranking-basis">แสดงทุกประเภท เรียงจากยอดเดิมพันรวม</small></div></header>{allPrizes.length === 0 ? <p className="empty-state">ยังไม่มีข้อมูล</p> : <div className="prize-bars">{allPrizes.map(([name, value], index) => <div key={name}><div><span className="prize-rank">{index + 1}</span><strong>{name}</strong><span>{value.count} รายการ</span></div><span><i style={{ width: `${value.stake / maxPrizeStake * 100}%` }}/></span><small>{MONEY.format(value.stake)} ฿</small></div>)}</div>}</article>
    </section>

    <section className="analytics-grid analytics-grid-bottom">
      <article className="analytics-card customer-table-card"><header><div><p className="eyebrow">Customer Frequency & Budget</p><h2>ลูกค้ามูลค่าสูงและการซื้อซ้ำ</h2></div></header><div className="analytics-table-wrap"><table><thead><tr><th>รหัสอ้างอิงลูกค้า</th><th className="num">จำนวนครั้ง</th><th className="num">รายการ</th><th className="num">ยอดซื้อรวม</th><th className="num">เฉลี่ย/ครั้ง</th></tr></thead><tbody>{customerRows.slice(0, 10).map((customer) => <tr key={customer.label}><td><strong>{customer.label}</strong></td><td className="num">{customer.bills}</td><td className="num">{customer.items}</td><td className="num">{MONEY.format(customer.spend)}</td><td className="num">{MONEY.format(customer.spend / customer.bills)}</td></tr>)}</tbody></table></div></article>
      <article className="analytics-card"><header><div><p className="eyebrow">Draw Performance</p><h2>งวดที่มีความต้องการสูง</h2></div></header><ol className="draw-ranking">{topDraws.map((row, index) => <li key={row.id}><b>{index + 1}</b><div><strong>{row.name}</strong><small>{row.bills} บิล</small></div><span>{MONEY.format(row.sales)} ฿</span></li>)}</ol></article>
    </section>

    <section className="analytics-note"><strong>ข้อควรเข้าใจเกี่ยวกับข้อมูล</strong><p>ระบบใช้ชื่อบิลเป็นรหัสอ้างอิงลูกค้า จึงควรกำหนดรหัสที่สม่ำเสมอ เช่น C001 เพื่อให้การซื้อซ้ำแม่นยำ และควรเก็บเฉพาะข้อมูลที่จำเป็น ตัวเลขที่ขายดีสะท้อนความต้องการเท่านั้น ไม่ได้มีโอกาสถูกรางวัลมากกว่าเลขอื่น</p></section>
  </main>;
}
