import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { drawDateLabel, lotteryLabel } from "@/lib/bills/betting";
import { loadAccountingReport, type AccountingTotals } from "@/lib/reports/accounting";
import { accountingHref, accountingLotterySelectionLabel, compareValueLabel, comparisonText, customCompareQueries, parseAccountingQuery, previousPeriodLabel, previousPeriodQuery, recentDays, recentMonths, recentWeeks, type CompareUnit } from "@/lib/reports/accounting-period";
import { COUNT_FORMAT, MONEY_FORMAT } from "@/lib/reports/terms";
import { ReportExportButtons } from "@/components/ReportExportButtons";
import { AccountingFilters } from "./AccountingFilters";
import { AgentTable, DrawTable } from "./AccountingTables";
import { InfoTip } from "../InfoTip";
import { ProfitReceipt } from "../ProfitReceipt";
import { CompareTable, profitSummary } from "../CompareTable";
import "./accounting.css";
import "../report-shared.css";

export const dynamic = "force-dynamic";

const baht = (value: number) => MONEY_FORMAT.format(value);

/**
 * สรุปบัญชี: ช่วงเวลาที่เลือกได้หรือเสียเท่าไร แยกรายงวดและราย Agent ส่งออก Excel ไปทำบัญชีต่อได้
 *
 * ลำดับบนหน้า (มือถือเลื่อนน้อยที่สุดก่อนเห็นตัวเลข):
 * กำลังดูอะไร → ตัวกรอง 3 แถว → กำไร/ขาดทุนพร้อมที่มา → ตัวเลขรอง → รายงวด → ราย Agent → ส่งออก
 */
export default async function AccountingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "report.viewAllAgents")) redirect("/reports");

  const now = new Date();
  const query = parseAccountingQuery(await searchParams, now);
  const previousQuery = query.compare === "previous" ? previousPeriodQuery(query, now) : null;
  // งวดให้เลือกในการเทียบรายงวด (ล่าสุดก่อน) เปิดรับแล้วเท่านั้น
  const drawSelect = { id: true, name: true, drawDate: true, lotteryType: true, status: true, cutoffAt: true } as const;
  const recentDraws = query.compare === "custom" && query.compareUnit === "draw"
    ? await prisma.draw.findMany({
        where: { ...orgScope(actor), opensAt: { lte: now } },
        orderBy: { cutoffAt: "desc" },
        take: 120,
        select: drawSelect,
      })
    : [];
  // งวด A/B ในลิงก์ที่เก่ากว่ารายการ: ดึงมาเพิ่ม ไม่เปลี่ยนเป็นงวดล่าสุดเงียบ ๆ
  const missingDrawIds = query.compare === "custom" && query.compareUnit === "draw"
    ? [query.compareA, query.compareB].filter((id) => id && !recentDraws.some((draw) => draw.id === id))
    : [];
  const drawOptions = missingDrawIds.length === 0 ? recentDraws : [
    ...recentDraws,
    ...await prisma.draw.findMany({ where: { ...orgScope(actor), id: { in: missingDrawIds } }, select: drawSelect }),
  ].sort((a, b) => b.cutoffAt.getTime() - a.cutoffAt.getTime());
  // ยังไม่ได้เลือกงวด: A = งวดล่าสุดของประเภทหวยที่กรองอยู่ · B = งวดก่อนหน้าของประเภทเดียวกัน
  const inFilter = drawOptions.filter((draw) => (query.lotteries as string[]).includes(draw.lotteryType));
  const drawA = drawOptions.find((draw) => draw.id === query.compareA)?.id ?? inFilter[0]?.id ?? drawOptions[0]?.id ?? "";
  const drawALottery = drawOptions.find((draw) => draw.id === drawA)?.lotteryType;
  // B ที่ยังไม่ได้เลือก: งวดก่อนหน้าของประเภทเดียวกับ A (เก่ากว่า A) ถ้าไม่มีจึงใช้งวดอื่นของประเภทเดียวกัน
  const drawAIndex = drawOptions.findIndex((draw) => draw.id === drawA);
  const sameLottery = (draw: (typeof drawOptions)[number]) => draw.id !== drawA && draw.lotteryType === drawALottery;
  const drawB = drawOptions.find((draw) => draw.id === query.compareB)?.id
    ?? drawOptions.slice(drawAIndex + 1).find(sameLottery)?.id
    ?? drawOptions.find(sameLottery)?.id
    ?? "";
  const drawLabel = (id: string) => {
    const draw = drawOptions.find((row) => row.id === id);
    return draw ? `${lotteryLabel(draw.lotteryType)} งวด ${drawDateLabel(draw)}` : "ยังไม่มีงวด";
  };
  // เลือกเอง: เทียบช่วง A กับช่วง B โดยไม่ขึ้นกับช่วงหลักของหน้า
  const customQueries = query.compare === "custom" ? customCompareQueries(query, drawA, drawB) : null;
  // เลือกเอง: ทั้งหน้า (กำไร ตัวเลขรอง รายงวด ราย Agent ส่งออก) เป็นของช่วง A ให้สอดคล้องกับที่เลือกเทียบ
  // ไม่โหลดช่วงหลักแยก เพราะจะได้ตัวเลขคนละชุดกับตารางเทียบ
  const [mainReport, previous, customA, customB, agentOptions] = await Promise.all([
    customQueries ? Promise.resolve(null) : loadAccountingReport(actor, query, now),
    previousQuery ? loadAccountingReport(actor, previousQuery, now) : Promise.resolve(null),
    customQueries ? loadAccountingReport(actor, customQueries[0], now) : Promise.resolve(null),
    customQueries ? loadAccountingReport(actor, customQueries[1], now) : Promise.resolve(null),
    prisma.agent.findMany({ where: orgScope(actor), orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  const report = (customA ?? mainReport)!;
  const viewQuery = customQueries ? customQueries[0] : query;
  const { totals } = report;
  const prev: AccountingTotals | undefined = previous?.totals;
  const pendingDraws = totals.draws - totals.settledDraws;
  // ส่งออกตามสิ่งที่แสดงอยู่ (เลือกเองแล้วเป็นช่วง A)
  const csvHref = accountingHref("/api/reports/accounting", viewQuery, {});
  const excelHref = `${csvHref}${csvHref.includes("?") ? "&" : "?"}format=xlsx`;
  const lotterySelection = query.compare === "custom" && query.compareUnit === "draw"
    ? "ประเภทหวยตามงวดที่เลือก"
    : accountingLotterySelectionLabel(query.lotteries);
  const agentName = query.agentId ? agentOptions.find((agent) => agent.id === query.agentId) : undefined;
  const settled = totals.settledDraws > 0;
  const loss = settled && totals.profit < 0;
  const compareLabel = previousPeriodLabel(query, now);
  // สองฝั่งของตารางเทียบ: เลือกเอง (ช่วง A กับ B) หรือเทียบกับช่วงก่อนหน้าของช่วงหลัก
  const customLabel = (value: string) => (query.compareUnit === "draw" ? drawLabel(value) : compareValueLabel(query.compareUnit, value));
  const comparisonSides = customA && customB
    ? {
        current: customA.totals,
        other: customB.totals,
        currentLabel: customLabel(query.compareUnit === "draw" ? drawA : query.compareA),
        otherLabel: customLabel(query.compareUnit === "draw" ? drawB : query.compareB),
        currentShort: "ช่วง A",
        otherShort: "ช่วง B",
      }
    : prev
      ? { current: totals, other: prev, currentLabel: report.range.label, otherLabel: compareLabel, currentShort: "ช่วงนี้", otherShort: "ช่วงก่อน" }
      : null;
  // ค่า A/B ในลิงก์ที่อยู่นอกรายการให้เลือก (เก่ากว่ารายการ) เพิ่มเข้าไปให้ช่องเลือกยังแสดงค่าที่ใช้อยู่
  const withSelected = (options: { value: string; label: string }[], unit: Exclude<CompareUnit, "draw">) => {
    if (query.compare !== "custom" || query.compareUnit !== unit) return options;
    const extra = [query.compareA, query.compareB]
      .filter((value, index, values) => value && values.indexOf(value) === index && !options.some((option) => option.value === value))
      .map((value) => ({ value, label: compareValueLabel(unit, value) }));
    return extra.length === 0 ? options : [...options, ...extra].sort((a, b) => b.value.localeCompare(a.value));
  };
  // ชื่อของสิ่งที่กำลังแสดง: เลือกเองแล้วเป็นช่วง A
  const viewLabel = customQueries && comparisonSides ? `ช่วง A · ${comparisonSides.currentLabel}` : report.range.label;

  return (
    <main className="workspace-page accounting-page">
      <header className="acc-head">
        <div>
          <p className="page-eyebrow"><Link href="/reports">รายงาน</Link> / สรุปบัญชี</p>
          <h1>สรุปบัญชี</h1>
          <p className="acc-viewing">
            กำลังดู: <strong>{viewLabel}</strong> · {lotterySelection}{agentName ? ` · ${agentName.code} ${agentName.name}` : " · ทุก Agent"}
          </p>
        </div>
        <ReportExportButtons className="acc-export acc-export-top" csvHref={csvHref} excelHref={excelHref} />
      </header>

      <AccountingFilters
        query={query}
        comparison={comparisonText(query, now)}
        months={withSelected(recentMonths(24, now).map((month, index) => ({ ...month, label: index === 0 ? `${month.label} (เดือนนี้)` : month.label })), "month")}
        weeks={withSelected(recentWeeks(26, now), "week")}
        days={withSelected(recentDays(120, now), "day")}
        draws={drawOptions.map((draw) => ({
          value: draw.id,
          label: `${lotteryLabel(draw.lotteryType)} งวด ${drawDateLabel(draw)}${draw.status === "OPEN" ? " (เปิดรับ)" : draw.status === "SETTLED" || draw.status === "CLOSED" ? "" : " (รอผล)"}`,
          lotteryType: draw.lotteryType,
        }))}
        drawA={drawA}
        drawB={drawB}
        agents={agentOptions.map((agent) => ({ id: agent.id, label: `${agent.code} · ${agent.name}` }))}
      />

      {query.lotteries.length === 0 ? (
        <p className="acc-empty">ยังไม่ได้เลือกประเภทหวย เลือก &ldquo;ทุกประเภท&rdquo; หรือประเภทที่ต้องการด้านบน</p>
      ) : (
        <>
          <section className={`acc-hero ${settled ? (loss ? "is-loss" : "is-profit") : "is-pending"}`} aria-labelledby="acc-hero-heading">
            <h2 id="acc-hero-heading">{customQueries && comparisonSides ? comparisonSides.currentLabel : report.range.label} ได้หรือเสีย</h2>
            {settled ? (
              <>
                <p className="acc-hero-answer">{loss ? "ขาดทุน" : "กำไร"} <strong>{baht(Math.abs(totals.profit))}</strong> บาท</p>
                <ProfitReceipt
                  gross={totals.settledGross}
                  payout={totals.payout}
                  commission={totals.settledCommission}
                  profit={totals.profit}
                  grossLabel={pendingDraws > 0 ? "ยอดขาย (คำนวณแล้ว)" : "ยอดขาย"}
                  grossTerm={pendingDraws > 0 ? "settledGross" : "gross"}
                />
                {pendingDraws > 0 && (
                  <p className="acc-hero-note">
                    คิดจาก {COUNT_FORMAT.format(totals.settledDraws)} งวดที่คำนวณแล้ว · อีก {COUNT_FORMAT.format(pendingDraws)} งวดรอผล
                    ยอดขาย {baht(totals.pendingGross)} บาท ยังไม่นับเป็นกำไร <InfoTip term="pendingGross" />
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="acc-hero-answer">ยังสรุปไม่ได้</p>
                <p className="acc-hero-note">
                  {totals.draws === 0
                    ? "ไม่มียอดขายในช่วงนี้"
                    : `ทั้ง ${COUNT_FORMAT.format(totals.draws)} งวดในช่วงนี้ยังรอผล จึงยังไม่รู้ยอดจ่ายรางวัลและกำไร ยอดขายตอนนี้ ${baht(totals.gross)} บาท`}
                </p>
              </>
            )}
          </section>

          {comparisonSides && (
            <CompareTable
              currentLabel={comparisonSides.currentLabel}
              previousLabel={comparisonSides.otherLabel}
              currentShort={comparisonSides.currentShort}
              previousShort={comparisonSides.otherShort}
              summary={profitSummary(
                comparisonSides.currentLabel,
                comparisonSides.otherLabel,
                comparisonSides.current.settledDraws > 0 ? comparisonSides.current.profit : null,
                comparisonSides.other.settledDraws > 0 ? comparisonSides.other.profit : null,
              )}
              note={[comparisonSides.current, comparisonSides.other]
                .map((side, index) => side.draws > side.settledDraws ? `${index === 0 ? comparisonSides.currentShort : comparisonSides.otherShort}ยังรอผล ${side.draws - side.settledDraws} งวด` : "")
                .filter(Boolean)
                .join(" · ") || undefined}
              rows={[
                { label: "กำไร / ขาดทุน", current: comparisonSides.current.settledDraws > 0 ? comparisonSides.current.profit : null, previous: comparisonSides.other.settledDraws > 0 ? comparisonSides.other.profit : null, better: "up", signedWord: true, emptyText: "ยังสรุปไม่ได้" },
                { label: "ยอดขาย", current: comparisonSides.current.gross, previous: comparisonSides.other.gross, better: "up", unit: "บาท" },
                { label: "จำนวนบิล", current: comparisonSides.current.bills, previous: comparisonSides.other.bills, better: "up", kind: "count", unit: "บิล" },
                { label: "จ่ายรางวัล", current: comparisonSides.current.payout, previous: comparisonSides.other.payout, better: "down", unit: "บาท" },
                { label: "ค่าคอม Agent", current: comparisonSides.current.commission, previous: comparisonSides.other.commission, better: "neutral", unit: "บาท" },
                { label: "ลูกค้าถูกรางวัล", current: comparisonSides.current.winners, previous: comparisonSides.other.winners, better: "neutral", kind: "count", unit: "คน" },
              ]}
            />
          )}

          <section className="acc-kpis" aria-label="ตัวเลขอื่นของช่วงนี้">
            <article>
              <span>ยอดขายทั้งหมด <InfoTip term="gross" /></span>
              <strong>{baht(totals.gross)}</strong>
              <small>{COUNT_FORMAT.format(totals.draws)} งวด · {COUNT_FORMAT.format(totals.bills)} บิล{totals.pendingGross > 0 ? ` · รอผล ${baht(totals.pendingGross)}` : ""}</small>
            </article>
            <article>
              <span>ค่าคอม Agent <InfoTip term="commission" /></span>
              <strong>{baht(totals.commission)}</strong>
              <small>รวมทุกงวด{pendingDraws > 0 ? " (งวดรอผลประมาณจาก %)" : ""}</small>
            </article>
            <article>
              <span>หลังหักคอม <InfoTip term="afterCommission" /></span>
              <strong>{baht(totals.net)}</strong>
              <small>ยอดที่ Agent ต้องส่ง</small>
            </article>
            <article>
              <span>ลูกค้าถูกรางวัล</span>
              <strong>{COUNT_FORMAT.format(totals.winners)} คน</strong>
              <small>จ่าย {baht(totals.payout)} บาท</small>
            </article>
          </section>

          <section className="acc-card" aria-labelledby="acc-draws-heading">
            <header><h2 id="acc-draws-heading">แยกรายงวด</h2><span>กดที่งวดเพื่อดูยอดของแต่ละ Agent</span></header>
            {report.draws.length === 0 ? <p className="acc-empty">ไม่มียอดขายในช่วงนี้</p> : (
              <DrawTable
                totals={totals}
                rows={report.draws.map((draw) => ({
                  drawId: draw.drawId,
                  lotteryType: draw.lotteryType,
                  title: `${lotteryLabel(draw.lotteryType)} งวด ${drawDateLabel(draw)}`,
                  settled: draw.settled,
                  bills: draw.bills,
                  winners: draw.winners,
                  gross: draw.gross,
                  commission: draw.commission,
                  estimated: draw.estimated,
                  net: draw.net,
                  payout: draw.payout,
                  profit: draw.profit,
                  agents: draw.agents.map((line) => ({
                    agentId: line.agentId,
                    code: line.code,
                    name: line.name,
                    commissionRate: line.commissionRate,
                    gross: line.gross,
                    commission: line.commission,
                    estimated: line.estimated,
                    net: line.net,
                    winners: line.winners,
                    payout: line.payout,
                    profit: line.profit,
                  })),
                }))}
              />
            )}
          </section>

          <section className="acc-card" aria-labelledby="acc-agents-heading">
            <header><h2 id="acc-agents-heading">แต่ละ Agent</h2><span>รวมทุกงวดในช่วงที่เลือก · กำไร/ขาดทุนนับเฉพาะงวดที่คำนวณแล้ว</span></header>
            {report.agents.length === 0 ? <p className="acc-empty">ไม่มีข้อมูล Agent ในช่วงนี้</p> : (
              <AgentTable rows={report.agents.map(({ settledGross: _gross, settledCommission: _commission, ...agent }) => agent)} />
            )}
          </section>

          <section className="acc-card acc-export-card" aria-labelledby="acc-export-heading">
            <header><h2 id="acc-export-heading">ส่งออกไปทำบัญชี</h2><span>ได้ตัวเลขชุดเดียวกับหน้านี้ ตามช่วงและตัวกรองที่เลือก</span></header>
            <ReportExportButtons className="acc-export" csvHref={csvHref} excelHref={excelHref} />
          </section>
        </>
      )}
    </main>
  );
}
