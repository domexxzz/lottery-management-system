import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { drawDateLabel, lotteryLabel } from "@/lib/bills/betting";
import { loadAccountingReport, type AccountingDrawRow } from "@/lib/reports/accounting";
import { accountingHref, bangkokToday, parseAccountingQuery } from "@/lib/reports/accounting-period";
import { LotteryFlag } from "../../bills/ThaiFlag";
import { AccountingFilters } from "./AccountingFilters";
import "./accounting.css";

export const dynamic = "force-dynamic";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat("th-TH");
const MONTH = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: "UTC" });

const baht = (value: number) => MONEY.format(value);
const signed = (value: number) => `${value < 0 ? "−" : "+"}${MONEY.format(Math.abs(value))}`;
const tone = (value: number) => (value < 0 ? "is-loss" : "is-profit");

/** เดือนย้อนหลัง 24 เดือนสำหรับตัวเลือกรายเดือน */
function recentMonthOptions(today: string) {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: 24 }, (_, index) => {
    const date = new Date(Date.UTC(year!, month! - 1 - index, 1));
    return { value: date.toISOString().slice(0, 7), label: MONTH.format(date) };
  });
}

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
  const today = bangkokToday(now);
  const [report, drawOptions, agentOptions, firstDraw] = await Promise.all([
    loadAccountingReport(actor, query, now),
    prisma.draw.findMany({
      where: { ...orgScope(actor), ...(query.lottery ? { lotteryType: query.lottery } : {}) },
      orderBy: { cutoffAt: "desc" },
      take: 120,
      select: { id: true, name: true, drawDate: true, lotteryType: true },
    }),
    prisma.agent.findMany({ where: orgScope(actor), orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.draw.findFirst({ where: orgScope(actor), orderBy: { cutoffAt: "asc" }, select: { cutoffAt: true } }),
  ]);
  const firstYear = Number(firstDraw ? bangkokToday(firstDraw.cutoffAt).slice(0, 4) : today.slice(0, 4));
  const years = Array.from({ length: Number(today.slice(0, 4)) - firstYear + 1 }, (_, index) => String(Number(today.slice(0, 4)) - index));
  const { totals } = report;
  const pending = totals.draws - totals.settledDraws;
  const selectedDraw = query.period === "draw" ? drawOptions.find((draw) => draw.id === query.drawId) : undefined;
  const title = query.period === "draw"
    ? (selectedDraw ? `${lotteryLabel(selectedDraw.lotteryType)} งวด ${drawDateLabel(selectedDraw)}` : "เลือกงวดที่ต้องการ")
    : report.range.label;
  const csvHref = accountingHref("/api/reports/accounting", query, {});
  const excelHref = `${csvHref}${csvHref.includes("?") ? "&" : "?"}format=xlsx`;

  return (
    <main className="workspace-page accounting-page">
      <header className="acc-head">
        <div>
          <p className="page-eyebrow"><Link href="/reports">รายงาน</Link> / สรุปบัญชี</p>
          <h1>สรุปบัญชี · {title}</h1>
          <p>ยอดสุทธิ = ยอดขาย − ค่าคอม · กำไร/ขาดทุน = ยอดสุทธิ − จ่ายรางวัล</p>
        </div>
        <div className="acc-export">
          <a className="acc-csv is-primary" href={excelHref}>⇩ ดาวน์โหลด Excel</a>
          <a className="acc-csv" href={csvHref}>CSV</a>
        </div>
      </header>

      <AccountingFilters
        query={query}
        draws={drawOptions.map((draw) => ({ id: draw.id, label: `${lotteryLabel(draw.lotteryType)} งวด ${drawDateLabel(draw)}`, lotteryType: draw.lotteryType }))}
        agents={agentOptions.map((agent) => ({ id: agent.id, label: `${agent.code} · ${agent.name}` }))}
        months={recentMonthOptions(today)}
        years={years}
      />

      <section className="acc-cards" aria-label="ยอดรวมของช่วงที่เลือก">
        <article><span>ยอดขาย</span><strong>{baht(totals.gross)}</strong><small>{COUNT.format(totals.draws)} งวด · {COUNT.format(totals.bills)} บิล</small></article>
        <article><span>ลูกค้าถูกรางวัล</span><strong>{COUNT.format(totals.winners)} คน</strong><small>นับเฉพาะงวดที่ออกผลแล้ว</small></article>
        <article><span>จ่ายรางวัล</span><strong>{baht(totals.payout)}</strong><small>เงินที่จ่ายลูกค้าที่ถูกรางวัล</small></article>
        <article><span>ค่าคอม Agent</span><strong>{baht(totals.commission)}</strong><small>รวมทุก Agent · ดูรายคนด้านล่าง</small></article>
        <article><span>ยอดสุทธิ</span><strong>{baht(totals.net)}</strong><small>ยอดขาย − ค่าคอม</small></article>
        <article className={tone(totals.profit)}><span>{totals.profit < 0 ? "ขาดทุน" : "กำไร"}</span><strong>{totals.profit < 0 ? "−" : ""}{baht(Math.abs(totals.profit))}</strong><small>ยอดสุทธิ − จ่ายรางวัล{pending > 0 ? ` · ยังไม่รวม ${pending} งวดที่รอผล` : ""}</small></article>
      </section>

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
