import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import "./analytics.css";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INTEGER = new Intl.NumberFormat("th-TH");

type CustomerRow = { label: string; bills: number; spend: number; items: number; numbers: Map<string, number> };

export default async function AnalyticsPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (actor.role !== "OWNER" && actor.role !== "ADMIN") redirect("/");

  const bills = await prisma.bill.findMany({
    where: { ...orgScope(actor), status: { in: ["CONFIRMED", "LOCKED", "SETTLED"] } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, title: true, totalStake: true, createdAt: true,
      draw: { select: { name: true } },
      items: { select: { number: true, stake: true, prizeType: { select: { name: true } } } },
    },
  });

  const customers = new Map<string, CustomerRow>();
  const numberDemand = new Map<string, { count: number; stake: number }>();
  const prizeDemand = new Map<string, { count: number; stake: number }>();
  const timeDemand = new Map<string, { bills: number; sales: number }>([["เช้า", { bills: 0, sales: 0 }], ["บ่าย", { bills: 0, sales: 0 }], ["เย็น/ค่ำ", { bills: 0, sales: 0 }]]);
  const drawDemand = new Map<string, { bills: number; sales: number }>();

  for (const bill of bills) {
    const customerKey = bill.title.trim().toLocaleLowerCase("th-TH") || `ไม่ระบุ-${bill.id}`;
    const customer = customers.get(customerKey) ?? { label: bill.title.trim() || "ไม่ระบุรหัส", bills: 0, spend: 0, items: 0, numbers: new Map() };
    customer.bills += 1;
    customer.spend += Number(bill.totalStake);
    customer.items += bill.items.length;
    for (const item of bill.items) {
      customer.numbers.set(item.number, (customer.numbers.get(item.number) ?? 0) + 1);
      const number = numberDemand.get(item.number) ?? { count: 0, stake: 0 };
      number.count += 1; number.stake += Number(item.stake); numberDemand.set(item.number, number);
      const prize = prizeDemand.get(item.prizeType.name) ?? { count: 0, stake: 0 };
      prize.count += 1; prize.stake += Number(item.stake); prizeDemand.set(item.prizeType.name, prize);
    }
    customers.set(customerKey, customer);
    const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: "Asia/Bangkok" }).format(bill.createdAt));
    const period = hour < 12 ? "เช้า" : hour < 17 ? "บ่าย" : "เย็น/ค่ำ";
    const time = timeDemand.get(period)!; time.bills += 1; time.sales += Number(bill.totalStake);
    const draw = drawDemand.get(bill.draw.name) ?? { bills: 0, sales: 0 };
    draw.bills += 1; draw.sales += Number(bill.totalStake); drawDemand.set(bill.draw.name, draw);
  }

  const customerRows = [...customers.values()].sort((a, b) => b.spend - a.spend);
  const totalSales = bills.reduce((sum, bill) => sum + Number(bill.totalStake), 0);
  const repeatCustomers = customerRows.filter((customer) => customer.bills > 1).length;
  const repeatRate = customerRows.length ? repeatCustomers / customerRows.length * 100 : 0;
  const averageOrder = bills.length ? totalSales / bills.length : 0;
  const segments = [
    { label: "ลูกค้าประจำ", detail: "ซื้ออย่างน้อย 3 ครั้ง", count: customerRows.filter((row) => row.bills >= 3).length, color: "#168f91" },
    { label: "ซื้อตามโอกาส", detail: "ซื้อซ้ำ 2 ครั้ง", count: customerRows.filter((row) => row.bills === 2).length, color: "#efad3b" },
    { label: "ลูกค้าใหม่", detail: "พบเพียง 1 ครั้ง", count: customerRows.filter((row) => row.bills === 1).length, color: "#7566b1" },
    { label: "ไม่ระบุรหัส", detail: "ยังเชื่อมลูกค้าไม่ได้", count: customerRows.filter((row) => row.label === "ไม่ระบุรหัส").length, color: "#9aa8b1" },
  ];
  const topNumbers = [...numberDemand.entries()].sort((a, b) => b[1].count - a[1].count || b[1].stake - a[1].stake).slice(0, 10);
  const topPrizes = [...prizeDemand.entries()].sort((a, b) => b[1].stake - a[1].stake).slice(0, 6);
  const maxPrizeStake = Math.max(...topPrizes.map(([, value]) => value.stake), 1);
  const maxTimeSales = Math.max(...[...timeDemand.values()].map((value) => value.sales), 1);
  const topDraws = [...drawDemand.entries()].sort((a, b) => b[1].sales - a[1].sales).slice(0, 5);

  return <main className="analytics-page">
    <header className="analytics-hero">
      <div><Link href="/" className="back-link">← กลับหน้าภาพรวม</Link><p className="eyebrow">Lottery Customer Intelligence</p><h1>วิเคราะห์พฤติกรรมลูกค้าเชิงลึก</h1><p>เข้าใจว่าลูกค้าซื้ออะไร ซื้อเมื่อไร ซื้อบ่อยแค่ไหน และกลุ่มใดสร้างยอดขายหลัก</p></div>
      <div className="data-badge"><span>●</span><div><strong>ข้อมูลจริงจากระบบ</strong><small>{INTEGER.format(bills.length)} บิลที่ยืนยันแล้ว</small></div></div>
    </header>

    <section className="analytics-kpis" aria-label="ตัวเลขสำคัญ">
      <article><span>ยอดขายรวม</span><strong>{MONEY.format(totalSales)} ฿</strong><small>บิลที่ยืนยัน ล็อก หรือคำนวณแล้ว</small></article>
      <article><span>ลูกค้าทั้งหมด</span><strong>{INTEGER.format(customerRows.length)}</strong><small>อ้างอิงจากชื่อบิล/รหัสลูกค้า</small></article>
      <article><span>ลูกค้าซื้อซ้ำ</span><strong>{repeatRate.toFixed(1)}%</strong><small>{INTEGER.format(repeatCustomers)} รหัสที่ซื้อเกิน 1 ครั้ง</small></article>
      <article><span>ยอดซื้อเฉลี่ย</span><strong>{MONEY.format(averageOrder)} ฿</strong><small>ต่อหนึ่งบิล</small></article>
    </section>

    <section className="analytics-grid analytics-grid-main">
      <article className="analytics-card segment-card"><header><div><p className="eyebrow">Customer Segmentation</p><h2>สัดส่วนพฤติกรรมลูกค้า</h2></div></header><div className="segment-list">{segments.map((segment) => { const percent = customerRows.length ? segment.count / customerRows.length * 100 : 0; return <div key={segment.label} className="segment-row"><span className="segment-dot" style={{ background: segment.color }}/><div><strong>{segment.label}</strong><small>{segment.detail}</small><span className="segment-track"><i style={{ width: `${percent}%`, background: segment.color }}/></span></div><b>{segment.count}<small>{percent.toFixed(1)}%</small></b></div>; })}</div></article>
      <article className="analytics-card"><header><div><p className="eyebrow">Purchase Time</p><h2>ช่วงเวลาที่ลูกค้าซื้อ</h2></div></header><div className="time-bars">{[...timeDemand.entries()].map(([label, value]) => <div key={label}><div><strong>{label}</strong><span>{value.bills} บิล · {MONEY.format(value.sales)} ฿</span></div><span><i style={{ width: `${value.sales / maxTimeSales * 100}%` }}/></span></div>)}</div><p className="card-insight">ช่วงที่มียอดขายสูงสุด: <strong>{[...timeDemand.entries()].sort((a, b) => b[1].sales - a[1].sales)[0]?.[0] ?? "ยังไม่มีข้อมูล"}</strong></p></article>
    </section>

    <section className="analytics-grid analytics-grid-detail">
      <article className="analytics-card"><header><div><p className="eyebrow">Number Demand</p><h2>เลขที่มีความต้องการสูง</h2></div><span className="neutral-chip">ไม่ใช่การทำนายผล</span></header>{topNumbers.length === 0 ? <p className="empty-state">ยังไม่มีข้อมูล</p> : <div className="number-grid">{topNumbers.map(([number, value], index) => <div key={number}><b>{index + 1}</b><strong>{number}</strong><span>{value.count} รายการ</span><small>{MONEY.format(value.stake)} ฿</small></div>)}</div>}</article>
      <article className="analytics-card"><header><div><p className="eyebrow">Product Preference</p><h2>ประเภทรางวัลที่นิยม</h2></div></header><div className="prize-bars">{topPrizes.map(([name, value]) => <div key={name}><div><strong>{name}</strong><span>{value.count} รายการ</span></div><span><i style={{ width: `${value.stake / maxPrizeStake * 100}%` }}/></span><small>{MONEY.format(value.stake)} ฿</small></div>)}</div></article>
    </section>

    <section className="analytics-grid analytics-grid-bottom">
      <article className="analytics-card customer-table-card"><header><div><p className="eyebrow">Customer Frequency & Budget</p><h2>ลูกค้ามูลค่าสูงและการซื้อซ้ำ</h2></div></header><div className="analytics-table-wrap"><table><thead><tr><th>รหัสอ้างอิงลูกค้า</th><th className="num">จำนวนครั้ง</th><th className="num">รายการ</th><th className="num">ยอดซื้อรวม</th><th className="num">เฉลี่ย/ครั้ง</th></tr></thead><tbody>{customerRows.slice(0, 10).map((customer) => <tr key={customer.label}><td><strong>{customer.label}</strong></td><td className="num">{customer.bills}</td><td className="num">{customer.items}</td><td className="num">{MONEY.format(customer.spend)}</td><td className="num">{MONEY.format(customer.spend / customer.bills)}</td></tr>)}</tbody></table></div></article>
      <article className="analytics-card"><header><div><p className="eyebrow">Draw Performance</p><h2>งวดที่มีความต้องการสูง</h2></div></header><ol className="draw-ranking">{topDraws.map(([name, value], index) => <li key={name}><b>{index + 1}</b><div><strong>{name}</strong><small>{value.bills} บิล</small></div><span>{MONEY.format(value.sales)} ฿</span></li>)}</ol></article>
    </section>

    <section className="analytics-note"><strong>ข้อควรเข้าใจเกี่ยวกับข้อมูล</strong><p>ระบบใช้ชื่อบิลเป็นรหัสอ้างอิงลูกค้า จึงควรกำหนดรหัสที่สม่ำเสมอ เช่น C001 เพื่อให้การซื้อซ้ำแม่นยำ และควรเก็บเฉพาะข้อมูลที่จำเป็น ตัวเลขที่ขายดีสะท้อนความต้องการเท่านั้น ไม่ได้มีโอกาสถูกรางวัลมากกว่าเลขอื่น</p></section>
  </main>;
}
