import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { ALL_DRAWS, drawShortLabel, isAllLotteries, reportLotteryParam, type AllDrawsMoney, type DrawMoney, type OwnerReport as Report, type ReportDraw, type WinnerSummary } from "@/lib/reports/owner-report";
import { lotteryLabel } from "@/lib/bills/betting";
import { BREAKDOWN_DAYS, type LotteryBreakdown } from "@/lib/reports/owner-report";
import { COUNT_FORMAT, MONEY_FORMAT } from "@/lib/reports/terms";
import { InfoTip } from "./InfoTip";
import { ProfitReceipt } from "./ProfitReceipt";
import { ReportViewPicker } from "./ReportViewPicker";
import "./owner-report.css";
import "./report-shared.css";

// รูปแบบเงินเดียวกับหน้าสรุปบัญชี (ทศนิยม 2 ตำแหน่งเสมอ)
const MONEY = MONEY_FORMAT;
const COUNT = COUNT_FORMAT;

const STATUS_LABEL: Record<string, string> = {
  OPEN: "เปิดรับ",
  LOCKED: "ปิดรับแล้ว รอผล",
  RESULT_PENDING: "รอลงผล",
  SETTLED: "คำนวณแล้ว รออนุมัติปิดบัญชี",
  CLOSED: "ปิดบัญชีแล้ว",
};

const baht = (value: Prisma.Decimal) => MONEY.format(Number(value));
const CUTOFF_TIME = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

/** ชื่องวดเต็มที่แยกงวดวันเดียวกันออกจากกันได้ เช่น "หวยรัฐบาล 16 พ.ย. 69 · ปิด 14:00" */
function drawFullLabel(draw: ReportDraw): string {
  return `${lotteryLabel(draw.lotteryType)} ${drawShortLabel(draw)} · ปิด ${CUTOFF_TIME.format(draw.cutoffAt)}`;
}

/** ป้ายประเภทหวยแบบสั้นใต้แท่งกราฟ */
const LOTTERY_SHORT: Record<string, string> = { THAI_GOVERNMENT: "รัฐบาล", LAO: "ลาว", LAO_SET: "ลาวชุด" };

/** ตัวเลขสั้นบนกราฟ เช่น 24.5K, 1.2M */
function short(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  return `${sign}${Math.round(abs)}`;
}

/**
 * เทียบกับงวดก่อนของประเภทหวยเดียวกัน บอกทั้งตัวเลขของงวดก่อนและผลต่างเป็นคำ
 * (เดิมบอกแค่ "ดีกว่า X บาท" ไม่รู้ว่างวดก่อนได้เท่าไร)
 */
function Comparison({ selected, previous }: { selected: DrawMoney; previous: DrawMoney | null }) {
  if (!previous) return <p className="or-compare">ยังไม่มีงวดก่อนหน้าให้เทียบ</p>;
  const name = drawFullLabel(previous.draw);
  if (!previous.settled) return <p className="or-compare">งวดก่อน ({name}) ยังไม่คำนวณผล จึงยังเทียบกำไรไม่ได้</p>;
  const word = (value: Prisma.Decimal) => `${value.isNegative() ? "ขาดทุน" : "กำไร"} ${baht(value.abs())} บาท`;
  const diff = selected.net.minus(previous.net);
  return (
    <div className={`or-compare-box ${diff.isZero() ? "" : diff.isPositive() ? "is-good" : "is-bad"}`}>
      <p className="or-compare-row"><span>งวดนี้</span><strong>{word(selected.net)}</strong></p>
      <p className="or-compare-row"><span>งวดก่อน <small>{name}</small></span><strong>{word(previous.net)}</strong></p>
      <p className="or-compare-result">
        {diff.isZero() ? "ผลเท่ากับงวดก่อน" : `${diff.isPositive() ? "▲ ดีกว่างวดก่อน" : "▼ แย่กว่างวดก่อน"} ${baht(diff.abs())} บาท`}
      </p>
    </div>
  );
}

/** กราฟกำไร/ขาดทุนรายงวด วาดฝั่ง Server เป็น SVG ไม่ต้องโหลด JavaScript */
function NetChart({ trend, selectedId }: { trend: DrawMoney[]; selectedId: string }) {
  const width = 720;
  // แท่งมาจากหลายประเภทหวย (ดูทุกงวดของทุกประเภท) ต้องบอกประเภทใต้วันที่ วันเดียวกันจะได้ไม่สับสน
  const mixed = new Set(trend.map((row) => row.draw.lotteryType)).size > 1;
  const height = mixed ? 244 : 230;
  const top = 26;
  const bottom = mixed ? 48 : 34;
  const values = trend.map((row) => (row.settled ? Number(row.net) : 0));
  const max = Math.max(...values.map((value) => Math.abs(value)), 1);
  const hasNegative = values.some((value) => value < 0);
  const hasPositive = values.some((value) => value > 0) || !hasNegative;
  const plot = height - top - bottom;
  // แบ่งพื้นที่บน/ล่างตามข้อมูลจริง ถ้าไม่มีขาดทุนเลย ใช้พื้นที่ทั้งหมดเป็นฝั่งกำไร
  const zero = top + (hasPositive && hasNegative ? plot / 2 : hasNegative ? 0 : plot);
  const scale = (hasPositive && hasNegative ? plot / 2 : plot) / max;
  const slot = width / Math.max(trend.length, 1);
  const barWidth = Math.min(slot * 0.56, 46);

  return (
    <svg className="or-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="กราฟกำไรขาดทุนรายงวด">
      <line x1="0" x2={width} y1={zero} y2={zero} className="or-chart-zero" />
      {trend.map((row, index) => {
        const x = slot * index + (slot - barWidth) / 2;
        const value = values[index]!;
        const barHeight = Math.max(Math.abs(value) * scale, row.settled && value !== 0 ? 2 : 0);
        const y = value >= 0 ? zero - barHeight : zero;
        const selected = row.draw.id === selectedId;
        const tone = !row.settled ? "is-pending" : value < 0 ? "is-loss" : "is-profit";
        return (
          <a key={row.draw.id} href={`/reports?draw=${row.draw.id}`} aria-label={`${lotteryLabel(row.draw.lotteryType)} งวด ${drawShortLabel(row.draw)} ${row.settled ? `${value < 0 ? "ขาดทุน" : "กำไร"} ${MONEY.format(Math.abs(value))} บาท` : "ยังไม่คำนวณ"}`}>
            <g className={`or-chart-bar ${tone}${selected ? " is-selected" : ""}`}>
              <rect x={slot * index} y={0} width={slot} height={height} className="or-chart-hit" />
              {row.settled
                ? <rect x={x} y={y} width={barWidth} height={barHeight} rx="4" />
                : <circle cx={x + barWidth / 2} cy={zero} r="4" />}
              <text x={x + barWidth / 2} y={value >= 0 ? y - 7 : y + barHeight + 15} textAnchor="middle" className="or-chart-value">
                {row.settled ? short(value) : "รอผล"}
              </text>
              <text x={x + barWidth / 2} y={height - (mixed ? 24 : 10)} textAnchor="middle" className="or-chart-label">{drawShortLabel(row.draw)}</text>
              {mixed && <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" className="or-chart-label">{LOTTERY_SHORT[row.draw.lotteryType] ?? ""}</text>}
            </g>
          </a>
        );
      })}
    </svg>
  );
}

const PROGRESS_STEPS = ["เปิดรับ", "ปิดรับ", "ลงผลรางวัล", "คำนวณผล"] as const;
const PROGRESS_INDEX: Record<string, number> = { OPEN: 0, LOCKED: 1, RESULT_PENDING: 2, SETTLED: 3, CLOSED: 3 };

/**
 * มือถือ: แท่งแนวนอนทีละงวด (ใหม่ → เก่า) แทนกราฟกว้างที่ต้องเลื่อนข้าง
 * กดแถวเพื่อดูงวดนั้น
 */
function TrendList({ trend, selectedId, mode }: { trend: DrawMoney[]; selectedId: string; mode: "net" | "sales" }) {
  const rows = [...trend].reverse().slice(0, 6);
  const value = (row: DrawMoney) => (mode === "net" ? (row.settled ? Number(row.net) : null) : Number(row.gross));
  const max = Math.max(...rows.map((row) => Math.abs(value(row) ?? 0)), 1);
  return (
    <ol className="or-trend-list" aria-label={mode === "net" ? "กำไร/ขาดทุน 6 งวดล่าสุด" : "ยอดขาย 6 งวดล่าสุด"}>
      {rows.map((row) => {
        const amount = value(row);
        const tone = amount === null ? "is-pending" : mode === "sales" ? "is-sales" : amount < 0 ? "is-loss" : "is-profit";
        return (
          <li key={row.draw.id} className={row.draw.id === selectedId ? "is-selected" : undefined}>
            <a href={`/reports?draw=${row.draw.id}`}>
              <span className="or-trend-name">{LOTTERY_SHORT[row.draw.lotteryType] ?? ""} {drawShortLabel(row.draw)}</span>
              <span className={`or-trend-bar ${tone}`}><i style={{ width: `${amount === null ? 0 : Math.max(Math.abs(amount) / max * 100, amount === 0 ? 0 : 3)}%` }} /></span>
              <strong className={tone}>{amount === null ? "รอผล" : `${mode === "net" && amount < 0 ? "−" : mode === "net" && amount > 0 ? "+" : ""}${MONEY.format(Math.abs(amount))}`}</strong>
            </a>
          </li>
        );
      })}
    </ol>
  );
}

/** ขั้นของงวดที่ยังไม่คำนวณ ให้เห็นว่าเหลืออะไรอีกก่อนสรุปกำไรได้ */
function DrawProgress({ status, cutoffAt }: { status: string; cutoffAt: Date }) {
  const current = PROGRESS_INDEX[status] ?? 0;
  return (
    <ol className="or-progress" aria-label="ขั้นตอนของงวด">
      {PROGRESS_STEPS.map((label, index) => (
        <li key={label} className={index < current ? "is-done" : index === current ? "is-current" : ""} aria-current={index === current ? "step" : undefined}>
          <b aria-hidden="true">{index < current ? "✓" : index + 1}</b>
          <span>{label}{index === 1 && <small>{CUTOFF_TIME.format(cutoffAt)} น.</small>}</span>
        </li>
      ))}
    </ol>
  );
}

/** ยอดขายรายงวดเมื่อยังไม่มีงวดที่คำนวณผล วาดฝั่ง Server เป็น SVG */
function SalesChart({ trend, selectedId }: { trend: DrawMoney[]; selectedId: string }) {
  const width = 720;
  const mixed = new Set(trend.map((row) => row.draw.lotteryType)).size > 1;
  const height = mixed ? 214 : 200;
  const top = 26;
  const bottom = mixed ? 48 : 34;
  const plot = height - top - bottom;
  const max = Math.max(...trend.map((row) => Number(row.gross)), 1);
  // งวดน้อยแท่งจะไม่กว้างเต็มการ์ด จำกัดความกว้างช่องไว้ให้ดูเป็นกราฟ
  const slot = Math.min(width / Math.max(trend.length, 1), 120);
  const offset = (width - slot * trend.length) / 2;
  const barWidth = Math.min(slot * 0.56, 46);
  return (
    <svg className="or-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="กราฟยอดขายรายงวดที่ยังรอผล">
      <line x1="0" x2={width} y1={top + plot} y2={top + plot} className="or-chart-zero" />
      {trend.map((row, index) => {
        const value = Number(row.gross);
        const barHeight = Math.max(value / max * plot, value > 0 ? 3 : 0);
        const x = offset + slot * index + (slot - barWidth) / 2;
        const y = top + plot - barHeight;
        return (
          <a key={row.draw.id} href={`/reports?draw=${row.draw.id}`} aria-label={`${lotteryLabel(row.draw.lotteryType)} งวด ${drawShortLabel(row.draw)} ยอดขาย ${MONEY.format(value)} บาท รอผล`}>
            <g className={`or-chart-bar is-sales${row.draw.id === selectedId ? " is-selected" : ""}`}>
              <rect x={offset + slot * index} y={0} width={slot} height={height} className="or-chart-hit" />
              <rect x={x} y={y} width={barWidth} height={barHeight} rx="4" />
              <text x={x + barWidth / 2} y={y - 7} textAnchor="middle" className="or-chart-value">{short(value)}</text>
              <text x={x + barWidth / 2} y={height - (mixed ? 24 : 10)} textAnchor="middle" className="or-chart-label">{drawShortLabel(row.draw)}</text>
              {mixed && <text x={x + barWidth / 2} y={height - 8} textAnchor="middle" className="or-chart-label">{LOTTERY_SHORT[row.draw.lotteryType] ?? ""}</text>}
            </g>
          </a>
        );
      })}
    </svg>
  );
}

export function OwnerReport({ report }: { report: Report }) {
  const { selected, all, previous, trend, agents, agentTotal, prizes } = report;
  // ดูทุกงวด: ไม่มีงวดเดียวให้โฟกัส ใช้ผลรวมของทุกงวดในประเภทหวยที่เลือก
  const draw = selected?.draw ?? null;
  const settled = all ? all.settledCount > 0 : Boolean(selected?.settled);
  const net = all ? all.net : selected!.net;
  const loss = settled && net.isNegative();
  const topPrizes = prizes.slice(0, 5);
  const otherPrizes = prizes.slice(5);
  const biggestPayout = prizes.find((prize) => prize.payout.isPositive());
  const allLotteries = isAllLotteries(report.lotteries);
  const lotteryName = allLotteries ? "ทุกประเภท" : report.lotteries.map((lottery) => lotteryLabel(lottery)).join(" + ");
  const scopeWord = all ? "ช่วงนี้" : "งวดนี้";

  return (
    <main className="workspace-page owner-report">
      <header className="or-head">
        <div>
          <p className="page-eyebrow">รายงาน · กำลังดู</p>
          {all ? (
            <>
              <h1>รวมทุกงวด · {lotteryName}</h1>
              <p>
                {COUNT.format(all.drawCount)} งวด
                {all.firstDraw && all.lastDraw ? ` (${drawShortLabel(all.firstDraw)} – ${drawShortLabel(all.lastDraw)})` : ""}
                {" · "}คำนวณแล้ว <strong>{COUNT.format(all.settledCount)}</strong> งวด
              </p>
            </>
          ) : (
            <>
              <h1>{lotteryLabel(draw!.lotteryType)} งวด {drawShortLabel(draw!)}</h1>
              <p>ปิดรับ {CUTOFF_TIME.format(draw!.cutoffAt)} น. · สถานะงวด: <strong>{STATUS_LABEL[draw!.status] ?? draw!.status}</strong></p>
            </>
          )}
        </div>
      </header>

      <ReportViewPicker
        lotteries={[...report.lotteries]}
        selectedId={all ? ALL_DRAWS : draw!.id}
        draws={report.draws.map((row) => ({
          id: row.id,
          lotteryType: row.lotteryType,
          fullLabel: `${lotteryLabel(row.lotteryType)} · ${drawShortLabel(row)}`,
          open: row.status === "OPEN",
          settled: row.status === "SETTLED" || row.status === "CLOSED",
        }))}
      />

      {all ? <AllDrawsResult all={all} /> : (
        <section className={`or-card or-result ${selected!.settled ? (loss ? "is-loss" : "is-profit") : "is-pending"}`} aria-labelledby="or-result-heading">
          <h2 id="or-result-heading">งวดนี้ได้หรือเสีย</h2>
          {selected!.settled ? (
            <>
              <p className="or-answer">{loss ? "ขาดทุน" : "กำไร"} <strong>{baht(selected!.net.abs())}</strong> บาท</p>
              <Comparison selected={selected!} previous={previous} />
              <ProfitReceipt
                gross={Number(selected!.gross)}
                payout={Number(selected!.payout)}
                commission={Number(selected!.commission)}
                profit={Number(selected!.net)}
              />
              <p className="or-note">จาก {COUNT.format(selected!.billCount)} บิล · {COUNT.format(selected!.agentCount)} Agent · หน่วยเป็นบาท</p>
            </>
          ) : (
            <>
              <p className="or-answer">{draw!.status === "OPEN" ? "กำลังเปิดรับ" : "รอผลรางวัล"}</p>
              <DrawProgress status={draw!.status} cutoffAt={draw!.cutoffAt} />
              <p className="or-compare">กำไรจะสรุปได้หลังลงผลและคำนวณงวดนี้ ตัวเลขด้านล่างคือยอดที่รับไว้แล้ว</p>
              <ol className="or-equation" aria-label="ตัวเลขตอนนี้">
                <li><span>ยอดขายตอนนี้</span><strong>{baht(selected!.gross)}</strong></li>
                <li><span>จำนวนบิล</span><strong>{COUNT.format(selected!.billCount)}</strong></li>
                <li><span>Agent ที่ขาย</span><strong>{COUNT.format(selected!.agentCount)}</strong></li>
                <li><span>เฉลี่ยต่อบิล</span><strong>{selected!.billCount > 0 ? baht(selected!.gross.div(selected!.billCount)) : "0"}</strong></li>
              </ol>
              <p className="or-note"><Link href={`/draws/${draw!.id}`}>{draw!.status === "OPEN" ? "ไปหน้างวด →" : "ไปหน้างวดเพื่อลงผลรางวัล →"}</Link></p>
            </>
          )}
        </section>
      )}

      <WinnersCard
        winners={report.winners}
        settled={settled}
        scopeWord={scopeWord}
        href={`/bills?tab=WON&scope=all${draw ? `&draw=${draw.id}` : report.lotteries.length === 1 ? `&lottery=${report.lotteries[0]}` : ""}`}
      />

      <section id="where-money-went" className="or-section" aria-labelledby="or-money-heading">
        <h2 id="or-money-heading">เงินมาจากไหน ไปไหน</h2>

        <article className="or-card">
          {trend.some((row) => row.settled) ? (
            <>
              <header className="or-card-head">
                <h3>กำไร / ขาดทุน {trend.length} งวดล่าสุด</h3>
                <span>แท่งเขียว = กำไร · แท่งแดง = ขาดทุน · กดแท่งเพื่อดูงวดนั้น</span>
              </header>
              <div className="or-chart-scroll"><NetChart trend={trend} selectedId={draw?.id ?? ""} /></div>
              <TrendList trend={trend} selectedId={draw?.id ?? ""} mode="net" />
            </>
          ) : (
            // ยังไม่มีงวดที่คำนวณผล (เช่นหวยลาวที่เพิ่งเริ่ม) กราฟกำไรว่าง จึงแสดงยอดขายที่รอผลแทน
            <>
              <header className="or-card-head">
                <h3>ยอดขาย {trend.length} งวดล่าสุด · รอผล</h3>
                <span>กราฟกำไร / ขาดทุนจะขึ้นเมื่อคำนวณผลงวดแรก · กดแท่งเพื่อดูงวดนั้น</span>
              </header>
              <div className="or-chart-scroll"><SalesChart trend={trend} selectedId={draw?.id ?? ""} /></div>
              <TrendList trend={trend} selectedId={draw?.id ?? ""} mode="sales" />
            </>
          )}
        </article>

        <div className="or-grid">
          <article className="or-card">
            <header className="or-card-head">
              <h3>Agent ขายดี {Math.min(agents.length, 5)} อันดับ{all ? " (รวมทุกงวด)" : ""}</h3>
              {agentTotal > 0 && <Link href="/agents">ดูทั้งหมด {COUNT.format(agentTotal)} คน →</Link>}
            </header>
            {agents.length === 0 ? <p className="or-empty">{scopeWord}ยังไม่มียอดขาย</p> : (
              <table className="or-table">
                <thead>
                  <tr><th scope="col">Agent</th><th scope="col" className="num">ยอดขาย</th><th scope="col" className="num">จ่ายรางวัล</th><th scope="col" className="num">กำไร / ขาดทุน <InfoTip term="profit" /></th></tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr key={agent.agentId}>
                      <td data-label="Agent"><Link href={`/agents/${agent.agentId}`}><strong>{agent.code}</strong> {agent.name}</Link><small>{COUNT.format(agent.billCount)} บิล</small></td>
                      <td data-label="ยอดขาย" className="num">{baht(agent.gross)}</td>
                      <td data-label="จ่ายรางวัล" className="num">{settled ? baht(agent.payout) : "รอผล"}</td>
                      <td data-label="กำไร / ขาดทุน" className={`num ${settled ? (agent.net.isNegative() ? "is-loss" : "is-profit") : ""}`}>
                        {settled ? `${agent.net.isNegative() ? "−" : "+"}${baht(agent.net.abs())}` : "รอผล"}
                        {settled && <small>หักค่าคอม {baht(agent.commission)} แล้ว{all ? " · เฉพาะงวดที่คำนวณแล้ว" : ""}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>

          <article className="or-card">
            <header className="or-card-head">
              <h3>แยกตามประเภทการแทง{all ? " (รวมทุกงวด)" : ""}</h3>
              <span>{biggestPayout && settled ? `จ่ายมากสุด: ${biggestPayout.name}` : "เรียงจากจ่ายรางวัลมากสุด"}</span>
            </header>
            {prizes.length === 0 ? <p className="or-empty">{scopeWord}ยังไม่มียอดขาย</p> : (
              <>
                <PrizeTable rows={topPrizes} settled={settled} />
                {otherPrizes.length > 0 && (
                  <details className="or-more-rows">
                    <summary>ดูอีก {otherPrizes.length} ประเภท</summary>
                    <PrizeTable rows={otherPrizes} settled={settled} />
                  </details>
                )}
              </>
            )}
          </article>
        </div>
      </section>

      {report.breakdown.length > 1 && <LotteryBreakdownTable rows={report.breakdown} range={report.breakdownRange} lotteryParam={reportLotteryParam(report.lotteries)} />}

      <footer className="or-footer">
        <span>อยากเจาะลึกกว่านี้?</span>
        <Link href="/reports/accounting">สรุปบัญชี รายงวด / รายเดือน / รายปี →</Link>
        <Link href={draw ? `/reports/charts?draw=${draw.id}` : "/reports/charts"}>สร้างกราฟเอง (สำหรับนักบัญชี) →</Link>
      </footer>
    </main>
  );
}

/** ผลรวมทุกงวด: กำไรนับเฉพาะงวดที่คำนวณแล้ว สมการจึงใช้ยอดขายของงวดที่คำนวณแล้วให้ลงตัว */
function AllDrawsResult({ all }: { all: AllDrawsMoney }) {
  const settled = all.settledCount > 0;
  const loss = settled && all.net.isNegative();
  const pendingCount = all.drawCount - all.settledCount;
  const pendingGross = all.gross.minus(all.settledGross);
  return (
    <section className={`or-card or-result ${settled ? (loss ? "is-loss" : "is-profit") : "is-pending"}`} aria-labelledby="or-result-heading">
      <h2 id="or-result-heading">รวมทุกงวดได้หรือเสีย</h2>
      {settled ? (
        <>
          <p className="or-answer">{loss ? "ขาดทุน" : "กำไร"} <strong>{baht(all.net.abs())}</strong> บาท</p>
          <p className="or-compare">
            รวม {COUNT.format(all.settledCount)} งวดที่คำนวณแล้ว
            {pendingCount > 0 && ` · อีก ${COUNT.format(pendingCount)} งวดยังไม่คำนวณ ยอดขาย ${baht(pendingGross)} บาท ยังไม่นับเป็นกำไร`}
          </p>
          <ProfitReceipt
            gross={Number(all.settledGross)}
            payout={Number(all.payout)}
            commission={Number(all.commission)}
            profit={Number(all.net)}
            grossLabel="ยอดขาย (คำนวณแล้ว)"
            grossTerm="settledGross"
          />
          <p className="or-note">ยอดขายทุกงวด {baht(all.gross)} · {COUNT.format(all.billCount)} บิล · {COUNT.format(all.agentCount)} Agent · หน่วยเป็นบาท</p>
        </>
      ) : (
        <>
          <p className="or-answer">ยังสรุปไม่ได้</p>
          <p className="or-compare">ยังไม่มีงวดที่คำนวณผลรางวัล จึงยังไม่รู้ยอดจ่ายและกำไร</p>
          <ol className="or-equation" aria-label="ตัวเลขตอนนี้">
            <li><span>ยอดขายรวม</span><strong>{baht(all.gross)}</strong></li>
            <li><span>จำนวนบิล</span><strong>{COUNT.format(all.billCount)}</strong></li>
            <li><span>Agent ที่ขาย</span><strong>{COUNT.format(all.agentCount)}</strong></li>
          </ol>
        </>
      )}
    </section>
  );
}

function PrizeTable({ rows, settled }: { rows: Report["prizes"]; settled: boolean }) {
  return (
    <table className="or-table">
      <thead>
        <tr><th scope="col">ประเภท</th><th scope="col" className="num">ยอดขาย</th><th scope="col" className="num">จ่ายรางวัล</th><th scope="col" className="num">ยอดขาย − จ่ายรางวัล <InfoTip text="ส่วนที่เหลือของประเภทการแทงนี้ก่อนหักค่าคอม Agent ค่าคอมคิดรวมทั้งงวด จึงไม่ได้แยกตามประเภท" /></th></tr>
      </thead>
      <tbody>
        {rows.map((prize) => {
          // ใช้ยอดขายของงวดที่คำนวณแล้ว เมื่อดูทุกงวดจะไม่ปนยอดของงวดที่ยังไม่ออกผล
          const left = prize.settledGross.minus(prize.payout);
          return (
            <tr key={prize.code}>
              <td data-label="ประเภท"><strong>{prize.name}</strong><small>{COUNT.format(prize.itemCount)} รายการ{settled && prize.winnerCount > 0 ? ` · ถูก ${COUNT.format(prize.winnerCount)}` : ""}</small></td>
              <td data-label="ยอดขาย" className="num">{baht(prize.gross)}</td>
              <td data-label="จ่ายรางวัล" className="num">{settled ? baht(prize.payout) : "รอผล"}</td>
              <td data-label="ยอดขาย − จ่ายรางวัล" className={`num ${settled ? (left.isNegative() ? "is-loss" : "is-profit") : ""}`}>
                {settled ? `${left.isNegative() ? "−" : "+"}${baht(left.abs())}` : "รอผล"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * ยอด 30 วันล่าสุดแยกตามประเภทหวย พร้อมแถวรวม
 * แยก "ยอดขายที่คำนวณแล้ว" ออกจาก "รอผล" เพราะจ่ายรางวัล ค่าคอม และกำไร มีเฉพาะงวดที่คำนวณแล้ว
 * ยอดขายที่คำนวณแล้ว − จ่ายรางวัล − ค่าคอม = กำไร จึงลบกันได้ตรงในแถวเดียวกัน
 */
function LotteryBreakdownTable({ rows, range, lotteryParam }: { rows: LotteryBreakdown[]; range: { from: string; to: string }; lotteryParam: string }) {
  const zero = rows[0]!.gross.minus(rows[0]!.gross);
  const total = rows.reduce((sum, row) => ({
    gross: sum.gross.plus(row.gross),
    settledGross: sum.settledGross.plus(row.settledGross),
    payout: sum.payout.plus(row.payout),
    commission: sum.commission.plus(row.commission),
    net: sum.net.plus(row.net),
    drawCount: sum.drawCount + row.drawCount,
    settledCount: sum.settledCount + row.settledCount,
  }), { gross: zero, settledGross: zero, payout: zero, commission: zero, net: zero, drawCount: 0, settledCount: 0 });
  const tone = (value: Prisma.Decimal) => (value.isNegative() ? "is-loss" : "is-profit");
  const signed = (value: Prisma.Decimal) => `${value.isNegative() ? "−" : "+"}${baht(value.abs())}`;
  const cells = (row: typeof total, strong: boolean) => {
    const wrap = (text: string) => (strong ? <strong>{text}</strong> : text);
    return (
      <>
        <td data-label="งวด" className="num or-col-detail">{COUNT.format(row.drawCount)}{row.settledCount < row.drawCount && <small>คำนวณแล้ว {COUNT.format(row.settledCount)}</small>}</td>
        <td data-label="ยอดขายทั้งหมด" className="num">{wrap(baht(row.gross))}</td>
        <td data-label="รอผล" className="num or-pending-cell">{wrap(baht(row.gross.minus(row.settledGross)))}</td>
        <td data-label="ยอดขายที่คำนวณแล้ว" className="num or-col-detail">{wrap(baht(row.settledGross))}</td>
        <td data-label="จ่ายรางวัล" className="num or-col-detail">{wrap(baht(row.payout))}</td>
        <td data-label="ค่าคอม" className="num or-col-detail">{wrap(baht(row.commission))}</td>
        <td data-label="กำไร (คำนวณแล้ว)" className={`num ${tone(row.net)}`}>{wrap(signed(row.net))}</td>
      </>
    );
  };
  return (
    <section className="or-card" aria-labelledby="or-breakdown-heading">
      <header className="or-card-head">
        <h3 id="or-breakdown-heading">ภาพรวมแยกประเภทหวย · {BREAKDOWN_DAYS} วันล่าสุด</h3>
        <span>ยอดขายที่คำนวณแล้ว − จ่ายรางวัล − ค่าคอม = กำไร · ยอด &ldquo;รอผล&rdquo; ยังไม่นับเป็นกำไร <InfoTip term="pendingGross" /></span>
      </header>
      <p className="or-breakdown-more"><Link href={`/reports/accounting?period=custom&from=${range.from}&to=${range.to}${lotteryParam ? `&lotteries=${lotteryParam}` : ""}`}>ดูตัวเลขเต็มทุกคอลัมน์ในสรุปบัญชี →</Link></p>
      <table className="or-table or-breakdown-table">
        <thead>
          <tr><th scope="col">ประเภท</th><th scope="col" className="num">งวด</th><th scope="col" className="num">ยอดขายทั้งหมด</th><th scope="col" className="num">รอผล</th><th scope="col" className="num">ยอดขายที่คำนวณแล้ว</th><th scope="col" className="num">จ่ายรางวัล</th><th scope="col" className="num">ค่าคอม</th><th scope="col" className="num">กำไร (คำนวณแล้ว)</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.lotteryType}>
              <td data-label="ประเภท"><Link href={`/reports?lottery=${row.lotteryType}`}><strong>{lotteryLabel(row.lotteryType)}</strong></Link></td>
              {cells(row, false)}
            </tr>
          ))}
          <tr className="or-total-row">
            <td data-label="ประเภท"><strong>รวมทุกประเภท</strong></td>
            {cells(total, true)}
          </tr>
        </tbody>
      </table>
    </section>
  );
}

/** ใครถูกรางวัล: จำนวนบิล รายการ ลูกค้า และบิลที่ได้มากสุด */
function WinnersCard({ winners, settled, scopeWord, href }: { winners: WinnerSummary; settled: boolean; scopeWord: string; href: string }) {
  return (
    <section className="or-card or-winners" aria-labelledby="or-winners-heading">
      <header className="or-card-head">
        <h3 id="or-winners-heading">ใครถูกรางวัล{scopeWord}</h3>
        {winners.billCount > 0 && <Link href={href}>ดูบิลถูกรางวัลทั้งหมด →</Link>}
      </header>
      {!settled ? <p className="or-empty">ยังไม่ได้คำนวณผลรางวัล จึงยังไม่รู้ผู้ถูกรางวัล</p> : winners.billCount === 0 ? <p className="or-empty">{scopeWord}ไม่มีผู้ถูกรางวัล</p> : (
        <>
          <dl className="or-winner-stats">
            <div><dt>บิลที่ถูก</dt><dd>{COUNT.format(winners.billCount)}</dd></div>
            <div><dt>รายการที่ถูก</dt><dd>{COUNT.format(winners.itemCount)}</dd></div>
            <div><dt>ลูกค้าที่ถูก</dt><dd>{COUNT.format(winners.customerCount)}</dd></div>
            <div><dt>จ่ายรางวัลรวม</dt><dd>{baht(winners.payout)}</dd></div>
          </dl>
          <table className="or-table">
            <thead>
              <tr><th scope="col">ลูกค้า</th><th scope="col">Agent ผู้ขาย</th><th scope="col" className="num">รายการที่ถูก</th><th scope="col" className="num">ได้รับ</th></tr>
            </thead>
            <tbody>
              {winners.top.map((row) => (
                <tr key={row.billId}>
                  <td data-label="ลูกค้า"><Link href={`/bills/${row.billId}`}><strong>{row.customer}</strong></Link><small>{row.sequence !== null ? `บิล ${row.sequence} · ` : ""}งวด {row.drawLabel}</small></td>
                  <td data-label="Agent ผู้ขาย"><strong>{row.agentCode}</strong> {row.agentName}</td>
                  <td data-label="รายการที่ถูก" className="num">{COUNT.format(row.winningItems)}</td>
                  <td data-label="ได้รับ" className="num is-loss">{baht(row.payout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
