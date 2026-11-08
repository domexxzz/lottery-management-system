"use client";

import { useState } from "react";
import { ChartTabs } from "./ChartTabs";
import { DashboardIcon, type DashboardIconName } from "./DashboardIcon";
import "./owner-business-charts.css";

type FinanceRow = { label: string; gross: number; payout: number; commission: number; net: number };
type VolumeRow = { label: string; bills: number; average: number };
type View = "finance" | "agents" | "volume";
const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TABS = [
  { id: "finance", label: "เงินเข้า–ออก", icon: "report" },
  { id: "agents", label: "ผลงาน Agent", icon: "agent" },
  { id: "volume", label: "จำนวนบิล", icon: "bill" },
] as const;

export function OwnerBusinessCharts({ draws, agents, volume }: { draws: FinanceRow[]; agents: FinanceRow[]; volume: VolumeRow[] }) {
  const [view, setView] = useState<View>("finance");
  const rows = view === "agents" ? agents : draws;
  const maxFinance = Math.max(...rows.flatMap((row) => [row.gross, row.payout, Math.abs(row.net)]), 1);
  const maxBills = Math.max(...volume.map((row) => row.bills), 1);
  const maxAverage = Math.max(...volume.map((row) => row.average), 1);
  const total = draws.reduce((sum, row) => ({ gross: sum.gross + row.gross, payout: sum.payout + row.payout, commission: sum.commission + row.commission, net: sum.net + row.net }), { gross: 0, payout: 0, commission: 0, net: 0 });

  return <article className="dashboard-panel owner-chart-panel">
    <div className="panel-heading owner-chart-heading">
      <div><p className="eyebrow chart-eyebrow"><DashboardIcon name="report" /> Business Performance</p><h2>ภาพรวมธุรกิจ</h2><small>เปรียบเทียบยอดเงิน ผลงานตัวแทน และจำนวนบิล</small></div>
      <ChartTabs panelId="owner-chart" options={TABS} selected={view} onSelect={setView} />
    </div>

    <div id="owner-chart" role="tabpanel" aria-labelledby={`owner-chart-${view}`} tabIndex={0}>
    {view === "finance" && <><div className="owner-view-title"><strong>เงินเข้า–ออก แยกตามงวด</strong><span>ตัวเลขจาก Settlement ที่คำนวณแล้ว</span></div>
      {draws.length > 0 && <div className="owner-finance-summary">
        <FinanceSummary label="ยอดขายรวม" icon="bill" value={total.gross} />
        <FinanceSummary label="จ่ายรางวัล" icon="winner" value={total.payout} />
        <FinanceSummary label="คอมมิชชัน" icon="percent" value={total.commission} />
        <FinanceSummary label="คงเหลือสุทธิ" icon="wallet" value={total.net} tone={total.net < 0 ? "negative" : "positive"} />
      </div>}
      <FinanceSmallMultiples rows={draws}/>
    </>}
    {view === "agents" && <><div className="owner-view-title"><strong>ผลงาน Agent</strong><span>เรียงตามยอดขายสูงสุด</span></div><FinanceBars rows={agents} max={maxFinance} agent/></>}
    {view === "volume" && (volume.length ? <div className="owner-volume-chart">{volume.map((row) => <article key={row.label}><div><strong>{row.label}</strong><span>{row.bills} บิล</span></div><div className="volume-bars"><span><i style={{ width: `${row.bills / maxBills * 100}%` }}/></span><span className="average"><i style={{ width: `${row.average / maxAverage * 100}%` }}/></span></div><b>{MONEY.format(row.average)}<small>บาทเฉลี่ย/บิล</small></b></article>)}</div> : <p className="empty-state">ไม่พบบิลตามตัวกรองที่เลือก</p>)}
    </div>
  </article>;
}

function FinanceSummary({ label, icon, value, tone }: {
  label: string; icon: DashboardIconName; value: number; tone?: "negative" | "positive";
}) {
  return <div className={tone}>
    <i aria-hidden="true"><DashboardIcon name={icon} /></i>
    <span>{label}</span>
    <strong>{MONEY.format(value)}<span className="money-unit">&nbsp;บาท</span></strong>
  </div>;
}

const FINANCE_METRICS = [
  { key: "gross", label: "ยอดขาย", detail: "สเกลเฉพาะยอดขาย", tone: "gross" },
  { key: "payout", label: "จ่ายรางวัล", detail: "สเกลเฉพาะยอดจ่ายรางวัล", tone: "payout" },
  { key: "net", label: "ยอดสุทธิ", detail: "เส้นกลางคือศูนย์ · ซ้ายลบ / ขวาบวก", tone: "net" },
] as const;

function FinanceSmallMultiples({ rows }: { rows: FinanceRow[] }) {
  if (rows.length === 0) return <p className="empty-state">ยังไม่มี Settlement สำหรับแสดงกราฟจริง</p>;

  return <section className="finance-small-multiples" aria-label="กราฟการเงินแยกสเกลตามตัวชี้วัด">
    <p className="finance-scale-note"><b>หมายเหตุเรื่องสเกล</b> กราฟแต่ละชุดใช้สเกลของตัวเองเพื่อให้เห็นแนวโน้มชัดเจน จึงไม่ควรเปรียบเทียบความยาวแท่งข้ามชุด</p>
    <div className="finance-small-grid">{FINANCE_METRICS.map((metric) => {
      const maximum = Math.max(...rows.map((row) => Math.abs(row[metric.key])), 1);
      return <article className={`finance-small-card ${metric.tone}`} key={metric.key}>
        <header><div><strong>{metric.label}</strong><small>{metric.detail}</small></div><span>ค่าสูงสุด {MONEY.format(maximum)} บาท</span></header>
        <div className="finance-small-rows">{rows.map((row) => {
          const value = row[metric.key];
          const percent = Math.abs(value) / maximum * 100;
          const barStyle = metric.key === "net"
            ? value < 0 ? { width: `${percent / 2}%`, right: "50%" } : { width: `${percent / 2}%`, left: "50%" }
            : { width: `${percent}%`, left: 0 };
          return <div className="finance-small-row" key={row.label} title={`${row.label}: ${MONEY.format(value)} บาท`}>
            <span>{row.label}</span>
            <i className={metric.key === "net" ? "has-zero" : undefined}><b className={value < 0 ? "negative" : "positive"} style={barStyle}/></i>
            <strong className={value < 0 ? "negative" : undefined}>{MONEY.format(value)}<span className="money-unit">&nbsp;บาท</span></strong>
          </div>;
        })}</div>
      </article>;
    })}</div>
  </section>;
}

function FinanceBars({ rows, max, agent = false }: { rows: FinanceRow[]; max: number; agent?: boolean }) {
  if (rows.length === 0) return <p className="empty-state">ยังไม่มี Settlement สำหรับแสดงกราฟจริง</p>;
  return <div className="owner-finance-bars">{rows.map((row) => <article key={row.label}><header><strong>{row.label}</strong><small>{agent ? "ผลงานสะสม" : "Settlement จริง"}</small></header><div className="finance-metrics"><div><span>ยอดขาย</span><i><b className="gross" style={{ width: `${row.gross / max * 100}%` }}/></i><strong>{MONEY.format(row.gross)}<span className="money-unit">&nbsp;บาท</span></strong></div><div><span>จ่ายรางวัล</span><i><b className="payout" style={{ width: `${row.payout / max * 100}%` }}/></i><strong>{MONEY.format(row.payout)}<span className="money-unit">&nbsp;บาท</span></strong></div><div><span>สุทธิ</span><i><b className={row.net < 0 ? "net negative" : "net"} style={{ width: `${Math.abs(row.net) / max * 100}%` }}/></i><strong className={row.net < 0 ? "negative" : "positive"}>{MONEY.format(row.net)}<span className="money-unit">&nbsp;บาท</span></strong></div></div></article>)}</div>;
}
