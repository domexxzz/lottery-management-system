import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { drawDateLabel, lotteryLabel } from "@/lib/bills/betting";
import { loadAccountingReport, type AccountingDrawRow, type AccountingTotals } from "@/lib/reports/accounting";
import { accountingHref, accountingLotterySelectionLabel, parseAccountingQuery, type AccountingQuickPeriod } from "@/lib/reports/accounting-period";
import { LotteryFlag } from "../../bills/ThaiFlag";
import { AccountingFilters } from "./AccountingFilters";
import { ReportExportButtons } from "@/components/ReportExportButtons";
import "./accounting.css";

export const dynamic = "force-dynamic";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat("th-TH");

const baht = (value: number) => MONEY.format(value);
const signed = (value: number) => `${value < 0 ? "−" : "+"}${MONEY.format(Math.abs(value))}`;
const tone = (value: number) => (value < 0 ? "is-loss" : "is-profit");

/**
 * สรุปบัญชี: แต่ละงวดได้หรือเสียเท่าไร แยกค่าคอมราย Agent
 * ดูได้ทีละงวด รายเดือน 3/6 เดือน รายปี หรือกำหนดช่วงเอง และดาวน์โหลด Excel ไปทำบัญชีต่อได้
 */
export default async function AccountingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "report.viewAllAgents")) redirect("/reports");

  const now = new Date();
  const query = parseAccountingQuery(await searchParams, now);
  const reports = new Map<string, ReturnType<typeof loadAccountingReport>>();
  const reportFor = (period: typeof query.period | AccountingQuickPeriod) => {
    const key = period === "custom" ? `${period}:${query.from}:${query.to}` : period;
    const cached = reports.get(key);
    if (cached) return cached;
    const promise = loadAccountingReport(actor, { ...query, period }, now);
    reports.set(key, promise);
    return promise;
  };
  const [report, compareAReport, compareBReport, agentOptions] = await Promise.all([
    reportFor(query.period),
    reportFor(query.compareA),
    reportFor(query.compareB),
    prisma.agent.findMany({ where: orgScope(actor), orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  const { totals } = report;
  const pending = totals.draws - totals.settledDraws;
  const title = report.range.label;
  const csvHref = accountingHref("/api/reports/accounting", query, {});
  const excelHref = `${csvHref}${csvHref.includes("?") ? "&" : "?"}format=xlsx`;
  const lotterySelection = accountingLotterySelectionLabel(query.lotteries);

  return (
    <main className="workspace-page accounting-page">
      <header className="acc-head">
        <div>
          <p className="page-eyebrow"><Link href="/reports">รายงาน</Link> / สรุปบัญชี</p>
          <h1>สรุปบัญชี · {title}</h1>
          <p>{lotterySelection} · ยอดสุทธิ = ยอดขาย − ค่าคอม · กำไร/ขาดทุน = ยอดสุทธิ − จ่ายรางวัล</p>
        </div>
        <ReportExportButtons className="acc-export" csvHref={csvHref} excelHref={excelHref} />
      </header>

      <AccountingFilters
        query={query}
        agents={agentOptions.map((agent) => ({ id: agent.id, label: `${agent.code} · ${agent.name}` }))}
      />

      <section className="acc-cards" aria-label="ยอดรวมของช่วงที่เลือก">
        <article><span>ยอดขาย</span><strong>{baht(totals.gross)}</strong><small>{COUNT.format(totals.draws)} งวด · {COUNT.format(totals.bills)} บิล</small></article>
        <article><span>ลูกค้าถูกรางวัล</span><strong>{COUNT.format(totals.winners)} คน</strong><small>นับเฉพาะงวดที่ออกผลแล้ว</small></article>
        <article><span>จ่ายรางวัล</span><strong>{baht(totals.payout)}</strong><small>เงินที่จ่ายลูกค้าที่ถูกรางวัล</small></article>
        <article><span>ค่าคอม Agent</span><strong>{baht(totals.commission)}</strong><small>รวมทุก Agent · ดูรายคนด้านล่าง</small></article>
        <article><span>ยอดสุทธิ</span><strong>{baht(totals.net)}</strong><small>ยอดขาย − ค่าคอม</small></article>
        <article className={tone(totals.profit)}><span>{totals.profit < 0 ? "ขาดทุน" : "กำไร"}</span><strong>{totals.profit < 0 ? "−" : ""}{baht(Math.abs(totals.profit))}</strong><small>ยอดสุทธิ − จ่ายรางวัล{pending > 0 ? ` · ยังไม่รวม ${pending} งวดที่รอผล` : ""}</small></article>
      </section>

      <ComparisonSummary
        a={{ label: compareAReport.range.label, totals: compareAReport.totals }}
        b={{ label: compareBReport.range.label, totals: compareBReport.totals }}
      />

      <section className="acc-card" aria-labelledby="acc-draws-heading">
        <header><h2 id="acc-draws-heading">แยกรายงวด</h2><span>กดที่งวดเพื่อดูค่าคอมและยอดของแต่ละ Agent</span></header>
        {report.draws.length === 0 ? <p className="acc-empty">ไม่มียอดขายในช่วงนี้</p> : (
          <div className="acc-table-wrap">
            <table className="acc-table">
              <thead>
                <tr><th scope="col">งวด</th><th scope="col" className="num">ยอดขาย</th><th scope="col" className="num">ถูกรางวัล</th><th scope="col" className="num">จ่ายรางวัล</th><th scope="col" className="num">ค่าคอม</th><th scope="col" className="num">ยอดสุทธิ</th><th scope="col" className="num">กำไร / ขาดทุน</th></tr>
              </thead>
              {report.draws.map((draw) => <DrawRows key={draw.drawId} draw={draw} />)}
              <tfoot>
                <tr><th scope="row">รวม {COUNT.format(totals.draws)} งวด</th><td className="num">{baht(totals.gross)}</td><td className="num">{COUNT.format(totals.winners)} คน</td><td className="num">{baht(totals.payout)}</td><td className="num">{baht(totals.commission)}</td><td className="num">{baht(totals.net)}</td><td className={`num ${tone(totals.profit)}`}>{signed(totals.profit)}</td></tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="acc-card" aria-labelledby="acc-agents-heading">
        <header><h2 id="acc-agents-heading">ค่าคอมและผลของแต่ละ Agent</h2><span>รวมทุกงวดในช่วงที่เลือก</span></header>
        {report.agents.length === 0 ? <p className="acc-empty">ไม่มีข้อมูล Agent ในช่วงนี้</p> : (
          <div className="acc-table-wrap">
            <table className="acc-table">
              <thead>
                <tr><th scope="col">Agent</th><th scope="col" className="num">ยอดขาย</th><th scope="col" className="num">ค่าคอม</th><th scope="col" className="num">ยอดสุทธิ</th><th scope="col" className="num">ถูกรางวัล</th><th scope="col" className="num">จ่ายรางวัล</th><th scope="col" className="num">กำไร / ขาดทุน</th></tr>
              </thead>
              <tbody>
                {report.agents.map((agent) => (
                  <tr key={agent.agentId}>
                    <td data-label="Agent"><Link href={`/agents/${agent.agentId}`}><strong>{agent.code}</strong> {agent.name}</Link><small>{COUNT.format(agent.draws)} งวด · {COUNT.format(agent.bills)} บิล · คอม {agent.commissionRate.toFixed(0)}%</small></td>
                    <td data-label="ยอดขาย" className="num">{baht(agent.gross)}</td>
                    <td data-label="ค่าคอม" className="num">{baht(agent.commission)}</td>
                    <td data-label="ยอดสุทธิ" className="num">{baht(agent.net)}</td>
                    <td data-label="ถูกรางวัล" className="num">{COUNT.format(agent.winners)} คน</td>
                    <td data-label="จ่ายรางวัล" className="num">{baht(agent.payout)}</td>
                    <td data-label="กำไร / ขาดทุน" className={`num ${tone(agent.profit)}`}>{signed(agent.profit)}{agent.pendingDraws > 0 && <small>รอผล {agent.pendingDraws} งวด</small>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function ComparisonSummary({ a, b }: {
  a: { label: string; totals: AccountingTotals };
  b: { label: string; totals: AccountingTotals };
}) {
  const metrics = [
    { label: "ยอดขาย", a: a.totals.gross, b: b.totals.gross, format: baht, unit: "บาท" },
    { label: "จำนวนบิล", a: a.totals.bills, b: b.totals.bills, format: (value: number) => COUNT.format(value), unit: "บิล" },
    { label: "จ่ายรางวัล", a: a.totals.payout, b: b.totals.payout, format: baht, unit: "บาท" },
    { label: "ค่าคอม Agent", a: a.totals.commission, b: b.totals.commission, format: baht, unit: "บาท" },
    { label: "ยอดสุทธิ", a: a.totals.net, b: b.totals.net, format: baht, unit: "บาท" },
    { label: "กำไร / ขาดทุน", a: a.totals.profit, b: b.totals.profit, format: baht, unit: "บาท" },
  ];
  return (
    <section className="acc-compare" aria-labelledby="acc-compare-heading">
      <header>
        <div><p>เปรียบเทียบแบบสรุป</p><h2 id="acc-compare-heading">{a.label} <span>เทียบกับ</span> {b.label}</h2></div>
        <small>ส่วนต่างคำนวณจากช่วง A − ช่วง B และใช้ตัวกรองประเภทหวย/Agent เดียวกับด้านบน</small>
      </header>
      <div className="acc-compare-grid">
        {metrics.map((metric) => {
          const difference = Math.round((metric.a - metric.b) * 100) / 100;
          const percent = metric.b === 0 ? null : difference / Math.abs(metric.b) * 100;
          return (
            <article key={metric.label}>
              <h3>{metric.label}</h3>
              <div><span>ช่วง A</span><strong>{metric.format(metric.a)} <small>{metric.unit}</small></strong></div>
              <div><span>ช่วง B</span><strong>{metric.format(metric.b)} <small>{metric.unit}</small></strong></div>
              <footer className={difference > 0 ? "is-up" : difference < 0 ? "is-down" : ""}>
                ส่วนต่าง {difference > 0 ? "+" : ""}{metric.format(difference)} {metric.unit}
                {percent !== null && <small> ({percent > 0 ? "+" : ""}{percent.toFixed(1)}%)</small>}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DrawRows({ draw }: { draw: AccountingDrawRow }) {
  return (
    <tbody className="acc-draw">
      <tr>
        <td data-label="งวด">
          <details>
            <summary><LotteryFlag lotteryType={draw.lotteryType} /> <strong>{lotteryLabel(draw.lotteryType)} งวด {drawDateLabel(draw)}</strong><small>{draw.settled ? "คำนวณแล้ว" : "รอผล"} · {COUNT.format(draw.bills)} บิล · {draw.agents.length} Agent</small></summary>
            <table className="acc-agent-table">
              <thead><tr><th scope="col">Agent</th><th scope="col" className="num">ยอดขาย</th><th scope="col" className="num">ค่าคอม</th><th scope="col" className="num">ยอดสุทธิ</th><th scope="col" className="num">ถูกรางวัล</th><th scope="col" className="num">จ่ายรางวัล</th><th scope="col" className="num">กำไร / ขาดทุน</th></tr></thead>
              <tbody>
                {draw.agents.map((line) => (
                  <tr key={line.agentId}>
                    <td><Link href={`/agents/${line.agentId}?drawId=${draw.drawId}`}>{line.code} · {line.name}</Link></td>
                    <td className="num">{baht(line.gross)}</td>
                    <td className="num">{baht(line.commission)}{line.estimated && <small>ตาม {line.commissionRate.toFixed(0)}%</small>}</td>
                    <td className="num">{baht(line.net)}</td>
                    <td className="num">{line.profit === null ? "รอผล" : `${COUNT.format(line.winners)} คน`}</td>
                    <td className="num">{line.profit === null ? "รอผล" : baht(line.payout)}</td>
                    <td className={`num ${line.profit === null ? "" : tone(line.profit)}`}>{line.profit === null ? "รอผล" : signed(line.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </td>
        <td data-label="ยอดขาย" className="num">{baht(draw.gross)}</td>
        <td data-label="ถูกรางวัล" className="num">{draw.settled ? `${COUNT.format(draw.winners)} คน` : "รอผล"}</td>
        <td data-label="จ่ายรางวัล" className="num">{draw.settled ? baht(draw.payout) : "รอผล"}</td>
        <td data-label="ค่าคอม" className="num">{baht(draw.commission)}{draw.estimated && <small>ตาม %</small>}</td>
        <td data-label="ยอดสุทธิ" className="num">{baht(draw.net)}</td>
        <td data-label="กำไร / ขาดทุน" className={`num ${draw.profit === null ? "" : tone(draw.profit)}`}>{draw.profit === null ? "รอผล" : signed(draw.profit)}</td>
      </tr>
    </tbody>
  );
}
