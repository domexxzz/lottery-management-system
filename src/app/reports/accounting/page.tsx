import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { drawDateLabel } from "@/lib/bills/betting";
import { groupReportDraws, reportCategoryLabel } from "@/lib/reports/draw-groups";
import { loadAccountingReport, type AccountingTotals } from "@/lib/reports/accounting";
import { combineAccountingTotals } from "@/lib/reports/accounting-totals";
import { accountingHref, accountingLotterySelectionLabel, compareValueLabel, customCompareQueries, parseAccountingQuery, previousPeriodLabel, previousPeriodQuery, recentMonths, type AccountingCompareCategory } from "@/lib/reports/accounting-period";
import { COUNT_FORMAT, MONEY_FORMAT } from "@/lib/reports/terms";
import { ReportExportButtons } from "@/components/ReportExportButtons";
import { AccountingFilters } from "./AccountingFilters";
import { AgentTable, DrawTable } from "./AccountingTables";
import { InfoTip } from "../InfoTip";
import { ProfitReceipt } from "../ProfitReceipt";
import { CompareTable } from "../CompareTable";
import "./accounting.css";
import "../report-shared.css";

export const dynamic = "force-dynamic";

const baht = (value: number) => MONEY_FORMAT.format(value);

function ComparisonTotalCard({ title, label, totals, tone }: { title: string; label: string; totals: AccountingTotals; tone: "a" | "b" | "total" }) {
  const settled = totals.settledDraws > 0;
  const pending = totals.draws - totals.settledDraws;
  const loss = settled && totals.profit < 0;
  return <article className={`acc-comparison-total is-${tone} ${!settled ? "is-pending" : loss ? "is-loss" : "is-profit"}`}>
    <header><span>{title}</span><small title={label}>{label}</small></header>
    <p className="acc-comparison-result">
      {totals.draws === 0 ? <strong>ไม่มีข้อมูล</strong> : settled ? <><span>{loss ? "ขาดทุน" : "กำไร"}</span><strong>{loss ? "−" : ""}{baht(Math.abs(totals.profit))}</strong><small>บาท</small></> : <strong>ยังสรุปไม่ได้</strong>}
    </p>
    <dl>
      <div><dt>ยอดขาย</dt><dd>{baht(totals.gross)}</dd></div>
      <div><dt>จ่ายรางวัล</dt><dd>{baht(totals.payout)}</dd></div>
      <div><dt>ค่าคอม Agent</dt><dd>{baht(totals.commission)}</dd></div>
      <div><dt>หลังหักคอม</dt><dd>{baht(totals.net)}</dd></div>
    </dl>
    <footer>{COUNT_FORMAT.format(totals.draws)} งวด · {COUNT_FORMAT.format(totals.bills)} บิล{pending > 0 ? ` · รอผล ${COUNT_FORMAT.format(pending)} งวด` : ""}</footer>
  </article>;
}

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
  // ใช้ชุดเดียวกันทั้งตัวกรองหลักและการเปรียบเทียบ: ลาว + ลาวชุด family เดียวกันแสดงเพียงครั้งเดียว
  const drawSelect = { id: true, name: true, drawDate: true, lotteryType: true, status: true, cutoffAt: true, laoFamilyId: true } as const;
  const recentDraws = await prisma.draw.findMany({
    where: { ...orgScope(actor), opensAt: { lte: now } },
    orderBy: { cutoffAt: "desc" },
    take: 240,
    select: drawSelect,
  });
  // งวด A/B ในลิงก์ที่เก่ากว่ารายการ: ดึงมาเพิ่ม ไม่เปลี่ยนเป็นงวดล่าสุดเงียบ ๆ
  const requestedDrawIds = [query.drawIds?.[0], ...(query.compare === "custom" && query.compareUnit === "draw" ? [query.compareA, query.compareB] : [])].filter((id): id is string => Boolean(id));
  const missingDrawIds = requestedDrawIds.filter((id) => !recentDraws.some((draw) => draw.id === id));
  const physicalOptions = missingDrawIds.length === 0 ? recentDraws : [
    ...recentDraws,
    ...await prisma.draw.findMany({ where: { ...orgScope(actor), id: { in: missingDrawIds } }, select: drawSelect }),
  ];
  const missingFamilies = physicalOptions.filter((draw) => missingDrawIds.includes(draw.id) && draw.laoFamilyId).map((draw) => draw.laoFamilyId!);
  const withFamilies = missingFamilies.length === 0 ? physicalOptions : [
    ...physicalOptions,
    ...await prisma.draw.findMany({ where: { ...orgScope(actor), laoFamilyId: { in: missingFamilies } }, select: drawSelect }),
  ];
  const drawOptions = groupReportDraws([...new Map(withFamilies.map((draw) => [draw.id, draw])).values()]);
  // แต่ละฝั่งมีประเภทหวยของตัวเอง ไทยเทียบลาวจึงเลือกงวดและคำนวณคนละหมวดได้จริง
  const selectedA = drawOptions.find((draw) => draw.id === query.compareA && draw.category === query.compareLotteryA);
  const drawA = selectedA?.id ?? "";
  const selectedB = drawOptions.find((draw) => draw.id === query.compareB && draw.category === query.compareLotteryB && draw.id !== drawA);
  const drawB = selectedB?.id ?? "";
  const drawLabel = (id: string) => {
    const draw = drawOptions.find((row) => row.id === id);
    return draw ? `${reportCategoryLabel(draw.category)} งวด ${drawDateLabel(draw)}` : "ยังไม่มีงวด";
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
  const exportHref = accountingHref("/api/reports/accounting", viewQuery, {});
  const excelHref = `${exportHref}${exportHref.includes("?") ? "&" : "?"}format=xlsx`;
  const compareCategoryLabel = (category: AccountingCompareCategory) => category === "THAI_GOVERNMENT" ? "หวยรัฐบาล" : "หวยลาวและหวยลาวชุด";
  const lotterySelection = query.compare === "custom"
    ? `${compareCategoryLabel(query.compareLotteryA)} เทียบ ${compareCategoryLabel(query.compareLotteryB)}`
    : accountingLotterySelectionLabel(query.lotteries);
  const agentName = query.agentId ? agentOptions.find((agent) => agent.id === query.agentId) : undefined;
  const compareAgentA = query.compareAgentA ? agentOptions.find((agent) => agent.id === query.compareAgentA) : undefined;
  const compareAgentB = query.compareAgentB ? agentOptions.find((agent) => agent.id === query.compareAgentB) : undefined;
  const agentLabel = (agent: typeof compareAgentA) => agent ? `${agent.code} ${agent.name}` : "ทุก Agent";
  const viewAgent = query.compare === "custom" ? compareAgentA : agentName;
  const settled = totals.settledDraws > 0;
  const loss = settled && totals.profit < 0;
  const compareLabel = previousPeriodLabel(query, now);
  // สองฝั่งของตารางเทียบ: เลือกเอง (ช่วง A กับ B) หรือเทียบกับช่วงก่อนหน้าของช่วงหลัก
  const customLabel = (side: "A" | "B") => {
    const category = side === "A" ? query.compareLotteryA : query.compareLotteryB;
    if (query.compareUnit === "draw") {
      const draw = side === "A" ? drawA : drawB;
      return draw ? drawLabel(draw) : `รวมทุกงวด ${compareCategoryLabel(category)}`;
    }
    if (query.compareUnit === "range") {
      const from = side === "A" ? query.compareAFrom : query.compareBFrom;
      const to = side === "A" ? query.compareATo : query.compareBTo;
      return `${compareCategoryLabel(category)} · ${compareValueLabel("day", from)} – ${compareValueLabel("day", to)}`;
    }
    const value = side === "A" ? query.compareA : query.compareB;
    return value === "all" ? `รวมทุกเดือน ${compareCategoryLabel(category)}` : `${compareCategoryLabel(category)} · ${compareValueLabel(query.compareUnit, value)}`;
  };
  const customComparisonLabel = (side: "A" | "B") => `${customLabel(side)} · ${agentLabel(side === "A" ? compareAgentA : compareAgentB)}`;
  const comparisonSides = customA && customB
    ? {
        current: customA.totals,
        other: customB.totals,
        currentLabel: customComparisonLabel("A"),
        otherLabel: customComparisonLabel("B"),
        currentShort: "ช่วง A",
        otherShort: "ช่วง B",
      }
    : prev
      ? { current: totals, other: prev, currentLabel: report.range.label, otherLabel: compareLabel, currentShort: "ช่วงนี้", otherShort: "ช่วงก่อน" }
      : null;
  const comparisonTotal = comparisonSides ? combineAccountingTotals(comparisonSides.current, comparisonSides.other) : null;
  // ค่า A/B ในลิงก์ที่อยู่นอกรายการให้เลือก (เก่ากว่ารายการ) เพิ่มเข้าไปให้ช่องเลือกยังแสดงค่าที่ใช้อยู่
  const withSelectedMonths = (options: { value: string; label: string }[]) => {
    if (query.compare !== "custom" || query.compareUnit !== "month") return options;
    const extra = [query.compareA, query.compareB]
      .filter((value, index, values) => value && value !== "all" && values.indexOf(value) === index && !options.some((option) => option.value === value))
      .map((value) => ({ value, label: compareValueLabel("month", value) }));
    return extra.length === 0 ? options : [...options, ...extra].sort((a, b) => b.value.localeCompare(a.value));
  };
  // ชื่อของสิ่งที่กำลังแสดง: เลือกเองแล้วเป็นช่วง A
  const viewLabel = customQueries && comparisonSides ? `ช่วง A · ${customLabel("A")}` : report.range.label;

  return (
    <main className="workspace-page accounting-page">
      <header className="acc-head">
        <div>
          <p className="page-eyebrow"><Link href="/reports">รายงาน</Link> / สรุปบัญชี</p>
          <h1>สรุปบัญชี</h1>
          <p className="acc-viewing">
            กำลังดู: <strong>{viewLabel}</strong> · {lotterySelection}{viewAgent ? ` · ${viewAgent.code} ${viewAgent.name}` : " · ทุก Agent"}
          </p>
        </div>
        <ReportExportButtons className="acc-export acc-export-top" excelHref={excelHref} />
      </header>

      <AccountingFilters
        query={query}
        range={{ from: report.range.from, to: report.range.to }}
        months={[{ value: "all", label: "ทุกเดือน" }, ...withSelectedMonths(recentMonths(24, now).map((month, index) => ({ ...month, label: index === 0 ? `${month.label} (เดือนนี้)` : month.label })))]}
        draws={drawOptions.map((draw) => ({
          value: draw.id,
          label: `${reportCategoryLabel(draw.category)} งวด ${drawDateLabel(draw)}${draw.status === "OPEN" ? " (เปิดรับ)" : draw.status === "SETTLED" || draw.status === "CLOSED" ? "" : " (รอผล)"}`,
          lotteryType: draw.category,
        }))}
        drawA={drawA}
        drawB={drawB}
        agents={agentOptions.map((agent) => ({ id: agent.id, label: `${agent.code} · ${agent.name}` }))}
      />

      {viewQuery.lotteries.length === 0 ? (
        <p className="acc-empty">ยังไม่ได้เลือกประเภทหวย เลือก &ldquo;ทุกประเภท&rdquo; หรือประเภทที่ต้องการด้านบน</p>
      ) : (
        <>
          {comparisonSides && comparisonTotal ? <section className="acc-comparison-overview" aria-labelledby="acc-hero-heading">
            <header><div><h2 id="acc-hero-heading">ผลลัพธ์ตามตัวกรอง</h2><p>แบ่งผลเปรียบเทียบเป็นช่วง A, ช่วง B และยอดรวมของทั้งสองช่วง</p></div><span>รวม = ช่วง A + ช่วง B</span></header>
            <div className="acc-comparison-total-grid">
              <ComparisonTotalCard title="ช่วง A" label={comparisonSides.currentLabel} totals={comparisonSides.current} tone="a" />
              <ComparisonTotalCard title="ช่วง B" label={comparisonSides.otherLabel} totals={comparisonSides.other} tone="b" />
              <ComparisonTotalCard title="รวม" label="ช่วง A + ช่วง B" totals={comparisonTotal} tone="total" />
            </div>
          </section> : <section className={`acc-hero ${settled ? (loss ? "is-loss" : "is-profit") : "is-pending"}`} aria-labelledby="acc-hero-heading">
            <h2 id="acc-hero-heading">ผลลัพธ์ตามตัวกรอง</h2>
            <p className="acc-hero-scope">{customQueries && comparisonSides ? customLabel("A") : report.range.label} · {lotterySelection}{viewAgent ? ` · ${viewAgent.code} ${viewAgent.name}` : " · ทุก Agent"}</p>
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
          </section>}

          {comparisonSides && (
            <CompareTable
              currentLabel={comparisonSides.currentLabel}
              previousLabel={comparisonSides.otherLabel}
              currentShort={comparisonSides.currentShort}
              previousShort={comparisonSides.otherShort}
              note={[comparisonSides.current, comparisonSides.other]
                .map((side, index) => side.draws > side.settledDraws ? `${index === 0 ? comparisonSides.currentShort : comparisonSides.otherShort}ยังรอผล ${side.draws - side.settledDraws} งวด` : "")
                .filter(Boolean)
                .join(" · ") || undefined}
              rows={[
                { label: "กำไร / ขาดทุน", icon: "analytics", current: comparisonSides.current.settledDraws > 0 ? comparisonSides.current.profit : null, previous: comparisonSides.other.settledDraws > 0 ? comparisonSides.other.profit : null, rule: "profit", signedWord: true, emptyText: "ยังสรุปไม่ได้" },
                { label: "ยอดขาย", icon: "wallet", current: comparisonSides.current.gross, previous: comparisonSides.other.gross, rule: "revenue", unit: "บาท" },
                { label: "จำนวนบิล", icon: "bill", current: comparisonSides.current.bills, previous: comparisonSides.other.bills, rule: "neutral", kind: "count", unit: "บิล" },
                { label: "จ่ายรางวัล", icon: "winner", current: comparisonSides.current.payout, previous: comparisonSides.other.payout, rule: "expense", unit: "บาท" },
                { label: "ค่าคอม Agent", icon: "percent", current: comparisonSides.current.commission, previous: comparisonSides.other.commission, rule: "expense", unit: "บาท" },
                { label: "ลูกค้าถูกรางวัล", icon: "agent", current: comparisonSides.current.winners, previous: comparisonSides.other.winners, rule: "winners", kind: "count", unit: "คน" },
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
                  title: `${reportCategoryLabel(draw.category)} งวด ${drawDateLabel(draw)}`,
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
            <ReportExportButtons className="acc-export" excelHref={excelHref} />
          </section>
        </>
      )}
    </main>
  );
}
