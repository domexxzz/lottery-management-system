"use client";

import { CommissionRateNote } from "@/components/CommissionRateNote";

import Link from "next/link";
import { Fragment, useState } from "react";
import { LotteryFlag } from "../../bills/ThaiFlag";
import { InfoTip } from "../InfoTip";
import { COUNT_FORMAT, MONEY_FORMAT } from "@/lib/reports/terms";

const baht = (value: number) => MONEY_FORMAT.format(value);
const signed = (value: number) => `${value < 0 ? "−" : "+"}${MONEY_FORMAT.format(Math.abs(value))}`;
const tone = (value: number) => (value < 0 ? "is-loss" : "is-profit");

export type DrawTableRow = {
  drawId: string;
  lotteryType: string;
  title: string;
  settled: boolean;
  bills: number;
  winners: number;
  gross: number;
  commission: number;
  estimated: boolean;
  net: number;
  payout: number;
  profit: number | null;
  agents: {
    agentId: string;
    code: string;
    name: string;
    commissionRate: number;
    baseCommissionRate: number;
    promotionApplied: boolean;
    gross: number;
    commission: number;
    estimated: boolean;
    net: number;
    winners: number;
    payout: number;
    profit: number | null;
  }[];
};

export type AgentTableRow = {
  agentId: string;
  code: string;
  name: string;
  commissionRate: number;
  baseRates: number[];
  promotionRates: number[];
  promotionDraws: number;
  draws: number;
  bills: number;
  winners: number;
  gross: number;
  commission: number;
  net: number;
  payout: number;
  profit: number;
  pendingDraws: number;
};

/**
 * ตารางรายงวด: จอใหญ่เป็นตาราง กดงวดแล้วรายละเอียดราย Agent เปิดเป็นแถวเต็มความกว้างใต้งวดนั้น
 * มือถือเป็นการ์ดที่เห็นยอดขายกับกำไรก่อน กด "ดูรายละเอียด" เพื่อดูที่เหลือ
 */
export function DrawTable({ rows, totals }: {
  rows: DrawTableRow[];
  totals: { draws: number; gross: number; winners: number; payout: number; commission: number; net: number; profit: number; settledDraws: number };
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="acc-table-wrap">
      <table className="acc-table acc-draw-table">
        <thead>
          <tr>
            <th scope="col">งวด</th>
            <th scope="col" className="num">ยอดขาย</th>
            <th scope="col" className="num">กำไร / ขาดทุน <InfoTip term="profit" /></th>
            <th scope="col" className="num acc-col-detail">จ่ายรางวัล</th>
            <th scope="col" className="num acc-col-detail">ค่าคอม</th>
            <th scope="col" className="num acc-col-detail">หลังหักคอม <InfoTip term="afterCommission" /></th>
            <th scope="col" className="num acc-col-detail">ถูกรางวัล</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = openId === row.drawId;
            return (
              <Fragment key={row.drawId}>
                <tr className={`acc-row ${open ? "is-open" : ""}`}>
                  <td className="acc-cell-title">
                    <button type="button" className="acc-row-toggle" aria-expanded={open} onClick={() => setOpenId(open ? null : row.drawId)}>
                      <LotteryFlag lotteryType={row.lotteryType} />
                      <span>
                        <strong>{row.title}</strong>
                        <small>{row.settled ? "คำนวณแล้ว" : "รอผล"} · {COUNT_FORMAT.format(row.bills)} บิล · {row.agents.length} Agent</small>
                      </span>
                      <i aria-hidden="true">{open ? "▴" : "▾"}</i>
                    </button>
                  </td>
                  <td data-label="ยอดขาย" className="num acc-key">{baht(row.gross)}</td>
                  <td data-label="กำไร / ขาดทุน" className={`num acc-key ${row.profit === null ? "is-pending" : tone(row.profit)}`}>{row.profit === null ? "รอผล" : signed(row.profit)}</td>
                  <td data-label="จ่ายรางวัล" className="num acc-col-detail">{row.settled ? baht(row.payout) : "รอผล"}</td>
                  <td data-label="ค่าคอม" className="num acc-col-detail">{baht(row.commission)}{row.estimated && <small>ประมาณจาก %</small>}</td>
                  <td data-label="หลังหักคอม" className="num acc-col-detail">{baht(row.net)}</td>
                  <td data-label="ถูกรางวัล" className="num acc-col-detail">{row.settled ? `${COUNT_FORMAT.format(row.winners)} คน` : "รอผล"}</td>
                </tr>
                {open && (
                  <tr className="acc-row-detail">
                    <td colSpan={7}>
                      <div className="acc-detail-mobile" aria-label="ตัวเลขอื่นของงวดนี้">
                        <span>จ่ายรางวัล <b>{row.settled ? baht(row.payout) : "รอผล"}</b></span>
                        <span>ค่าคอม <b>{baht(row.commission)}</b></span>
                        <span>หลังหักคอม <b>{baht(row.net)}</b></span>
                        <span>ถูกรางวัล <b>{row.settled ? `${COUNT_FORMAT.format(row.winners)} คน` : "รอผล"}</b></span>
                      </div>
                      <table className="acc-agent-table">
                        <thead><tr><th scope="col">Agent</th><th scope="col" className="num">ยอดขาย</th><th scope="col" className="num">ค่าคอม</th><th scope="col" className="num">หลังหักคอม</th><th scope="col" className="num">จ่ายรางวัล</th><th scope="col" className="num">กำไร / ขาดทุน</th></tr></thead>
                        <tbody>
                          {row.agents.map((line) => (
                            <tr key={line.agentId}>
                              <td data-label="Agent"><Link href={`/agents/${line.agentId}?drawId=${row.drawId}`}>{line.code} · {line.name}</Link></td>
                              <td data-label="ยอดขาย" className="num">{baht(line.gross)}</td>
                              <td data-label="ค่าคอม" className="num">{baht(line.commission)}<small className="accounting-rate">{line.commissionRate.toLocaleString("th-TH", { maximumFractionDigits: 2 })}%{line.promotionApplied && <b> โปรฯ</b>}{line.estimated && " ประมาณการ"}</small></td>
                              <td data-label="หลังหักคอม" className="num">{baht(line.net)}</td>
                              <td data-label="จ่ายรางวัล" className="num">{line.profit === null ? "รอผล" : baht(line.payout)}</td>
                              <td data-label="กำไร / ขาดทุน" className={`num ${line.profit === null ? "" : tone(line.profit)}`}>{line.profit === null ? "รอผล" : signed(line.profit)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">รวม {COUNT_FORMAT.format(totals.draws)} งวด</th>
            <td className="num">{baht(totals.gross)}</td>
            {totals.settledDraws === 0
              ? <td className="num is-pending">รอผล</td>
              : <td className={`num ${tone(totals.profit)}`}>{signed(totals.profit)}{totals.settledDraws < totals.draws && <small>คิดจาก {totals.settledDraws} งวดที่คำนวณแล้ว</small>}</td>}
            <td className="num acc-col-detail">{baht(totals.payout)}</td>
            <td className="num acc-col-detail">{baht(totals.commission)}</td>
            <td className="num acc-col-detail">{baht(totals.net)}</td>
            <td className="num acc-col-detail">{COUNT_FORMAT.format(totals.winners)} คน</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

type AgentSort = "gross" | "profit" | "loss";
const SORT_LABEL: Record<AgentSort, string> = { gross: "ยอดขาย", profit: "กำไรมากสุด", loss: "ขาดทุนมากสุด" };

/** ตาราง Agent เรียงได้ 3 แบบ และติดป้ายคนที่ทำกำไร/ขาดทุนมากที่สุด */
export function AgentTable({ rows }: { rows: AgentTableRow[] }) {
  const [sort, setSort] = useState<AgentSort>("gross");
  const [openId, setOpenId] = useState<string | null>(null);
  // เรียงตามกำไร/ขาดทุน: Agent ที่ยังรอผลทุกงวด (ยังไม่มีกำไรให้เทียบ) อยู่ท้ายสุด
  const pendingOnly = (row: AgentTableRow) => row.draws === row.pendingDraws;
  const sorted = [...rows].sort((a, b) =>
    sort === "gross" ? b.gross - a.gross || a.code.localeCompare(b.code)
      : Number(pendingOnly(a)) - Number(pendingOnly(b))
        || (sort === "profit" ? b.profit - a.profit : a.profit - b.profit)
        || a.code.localeCompare(b.code));
  const settledRows = rows.filter((row) => row.draws > row.pendingDraws);
  const best = settledRows.length > 1 ? settledRows.reduce((top, row) => (row.profit > top.profit ? row : top)) : undefined;
  const worst = settledRows.length > 1 ? settledRows.reduce((low, row) => (row.profit < low.profit ? row : low)) : undefined;

  return (
    <>
      <nav className="acc-chips acc-sort" aria-label="เรียงตาม">
        <span className="acc-filter-label">เรียงตาม</span>
        {(Object.keys(SORT_LABEL) as AgentSort[]).map((key) => (
          <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)}>{SORT_LABEL[key]}</button>
        ))}
      </nav>
      <div className="acc-table-wrap">
        <table className="acc-table acc-agent-summary">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col" className="num">ยอดขาย</th>
              <th scope="col" className="num">กำไร / ขาดทุน <InfoTip term="profit" /></th>
              <th scope="col" className="num acc-col-detail">ค่าคอม</th>
              <th scope="col" className="num acc-col-detail">หลังหักคอม</th>
              <th scope="col" className="num acc-col-detail">จ่ายรางวัล</th>
              <th scope="col" className="num acc-col-detail">ถูกรางวัล</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const open = openId === row.agentId;
              const badge = row.agentId === worst?.agentId && row.profit < 0 ? "ขาดทุนมากสุด" : row.agentId === best?.agentId && row.profit > 0 ? "กำไรมากสุด" : null;
              return (
                <Fragment key={row.agentId}>
                  <tr className={`acc-row ${open ? "is-open" : ""}`}>
                    <td className="acc-cell-title">
                      <button type="button" className="acc-row-toggle" aria-expanded={open} onClick={() => setOpenId(open ? null : row.agentId)}>
                        <span>
                          <strong>{row.code} {row.name}{badge && <em className={`acc-badge ${row.profit < 0 ? "is-loss" : "is-profit"}`}>{badge}</em>}</strong>
                          <small>{COUNT_FORMAT.format(row.draws)} งวด · {COUNT_FORMAT.format(row.bills)} บิล{row.pendingDraws > 0 ? ` · รอผล ${row.pendingDraws} งวด` : ""}</small><CommissionRateNote baseRates={row.baseRates} promotionRates={row.promotionRates} promotionDraws={row.promotionDraws} fallbackRate={row.commissionRate} />
                        </span>
                        <i aria-hidden="true">{open ? "▴" : "▾"}</i>
                      </button>
                    </td>
                    <td data-label="ยอดขาย" className="num acc-key">{baht(row.gross)}</td>
                    <td data-label="กำไร / ขาดทุน" className={`num acc-key ${row.draws === row.pendingDraws ? "is-pending" : tone(row.profit)}`}>{row.draws === row.pendingDraws ? "รอผล" : signed(row.profit)}</td>
                    <td data-label="ค่าคอม" className="num acc-col-detail">{baht(row.commission)}</td>
                    <td data-label="หลังหักคอม" className="num acc-col-detail">{baht(row.net)}</td>
                    <td data-label="จ่ายรางวัล" className="num acc-col-detail">{baht(row.payout)}</td>
                    <td data-label="ถูกรางวัล" className="num acc-col-detail">{COUNT_FORMAT.format(row.winners)} คน</td>
                  </tr>
                  {open && (
                    <tr className="acc-row-detail">
                      <td colSpan={7}>
                        <div className="acc-detail-mobile">
                          <span>ค่าคอม <b>{baht(row.commission)}</b></span>
                          <span>หลังหักคอม <b>{baht(row.net)}</b></span>
                          <span>จ่ายรางวัล <b>{baht(row.payout)}</b></span>
                          <span>ถูกรางวัล <b>{COUNT_FORMAT.format(row.winners)} คน</b></span>
                        </div>
                        <Link className="acc-detail-link" href={`/agents/${row.agentId}`}>ดูโปรไฟล์ {row.code} →</Link>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
