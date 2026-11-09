"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addEntries,
  buildEntries,
  compactRate,
  entryKey,
  groupPrizeTypes,
  type BetEntry,
  type BetPrizeType,
} from "@/lib/bills/betting";
import { placeBillAction, type ActionState } from "../actions";
import { CustomerNameCombobox } from "./BillForm";
import { ThaiFlag } from "../ThaiFlag";

const INITIAL: ActionState = { error: null };
const CHIPS = [5, 10, 20, 50, 100, 500, 1000] as const;
const MAX_STAKE = 10_000_000;

export type SlipDraw = {
  id: string;
  lotteryLabel: string;
  dateLabel: string;
  cutoffAt: string;
  cutoffLabel: string;
  open: boolean;
};

export type SlipRestriction = {
  prizeTypeId: string;
  /** เลขที่ normalize แล้ว (โต๊ดเรียงหลัก) */
  number: string;
  kind: "CLOSED" | "REDUCED_RATE";
  payoutRate: string | null;
};

export type SlipRepresentative = {
  id: string;
  displayName: string;
  roleLabel: string;
  agentCode: string | null;
  /** อัตราคอมมิชชันเป็นเปอร์เซ็นต์ null = ยังไม่มี Agent (ระบบจะสร้างให้และคอมเป็น 0) */
  commissionRate: string | null;
};

type Notice = { tone: "info" | "error"; text: string } | null;

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function reverseLabel(digits: number): string {
  if (digits === 2) return "สลับเลข (x2)";
  if (digits === 3) return "สลับเลข (x3 x6)";
  return "สลับเลข";
}

/** ป้ายสีของประเภทในรายการ ใช้กลุ่มเดียวกับแท็บ */
function badgeKey(rule: BetPrizeType | undefined): string {
  if (!rule) return "x";
  return rule.matchRule === "CONTAINS_DIGIT" ? "run" : `d${rule.digits}`;
}

/**
 * นาฬิกานับถอยหลังแยกเป็น component ของตัวเอง
 * เดิมทั้งหน้า re-render ทุกวินาทีเพราะเก็บเวลาไว้ใน state ของฟอร์มหลัก
 */
function Countdown({ cutoffAt }: { cutoffAt: string }) {
  // เริ่มเป็น null แล้วค่อยอ่านเวลาหลัง mount ไม่งั้นเวลาฝั่ง server กับ browser ต่างกันจน hydration พัง
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
  if (now === null) return <strong>--:--:--</strong>;
  const remaining = Math.max(0, Math.floor((new Date(cutoffAt).getTime() - now) / 1000));
  const days = Math.floor(remaining / 86_400);
  const clock = [Math.floor((remaining % 86_400) / 3600), Math.floor((remaining % 3600) / 60), remaining % 60]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
  return <strong>{days > 0 ? `${days} วัน ${clock}` : clock}</strong>;
}

/** true จนถึงเวลาปิดรับ แล้วเปลี่ยนครั้งเดียวด้วย timeout ไม่ต้อง render ทุกวินาที */
function useStillOpen(draw: SlipDraw | undefined): boolean {
  const cutoff = draw ? new Date(draw.cutoffAt).getTime() : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const wait = cutoff - Date.now();
    if (wait <= 0) return;
    // setTimeout รองรับได้ราว 24.8 วัน งวดที่ไกลกว่านั้นให้ตรวจซ้ำภายหลัง
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(wait + 50, 2_000_000_000));
    return () => window.clearTimeout(timer);
  }, [cutoff, now]);
  return Boolean(draw?.open && now < cutoff);
}

export function BetSlip({
  draws,
  prizeTypes,
  restrictions,
  representatives,
}: {
  draws: SlipDraw[];
  prizeTypes: BetPrizeType[];
  restrictions: Record<string, SlipRestriction[]>;
  /** null สำหรับ Agent ซึ่งสร้างบิลให้ตัวเองเท่านั้น */
  representatives: SlipRepresentative[] | null;
  ownCommissionRate: string | null;
}) {
  const [placeState, placeAction, placing] = useActionState(placeBillAction, INITIAL);
  const pending = placing;
  const serverError = placeState.error;

  const rules = useMemo(() => new Map(prizeTypes.map((prizeType) => [prizeType.id, prizeType])), [prizeTypes]);
  const groups = useMemo(() => groupPrizeTypes(prizeTypes), [prizeTypes]);

  const [drawId, setDrawId] = useState(draws[0]?.id ?? "");
  const draw = draws.find((item) => item.id === drawId) ?? draws[0];
  const isOpen = useStillOpen(draw);

  const [representativeId, setRepresentativeId] = useState("");
  const representative = representatives?.find((item) => item.id === representativeId);

  const [groupKey, setGroupKey] = useState(groups.find((item) => item.digits === 3)?.key ?? groups[0]?.key ?? "");
  const group = groups.find((item) => item.key === groupKey) ?? groups[0];
  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(groups.map((item) => [item.key, item.prizeTypes[0] ? [item.prizeTypes[0].id] : []])),
  );
  const [reverseByGroup, setReverseByGroup] = useState<Record<string, boolean>>({});
  const selectedIds = group ? selectedByGroup[group.key] ?? [] : [];
  const reverse = group ? reverseByGroup[group.key] ?? false : false;

  const [amount, setAmount] = useState(10);
  const [digits, setDigits] = useState("");
  const [entries, setEntries] = useState<BetEntry[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  // ชื่อลูกค้าเดิมโหลดทีหลัง เพื่อให้หน้าแสดงผลได้ทันที
  const [customerNames, setCustomerNames] = useState<string[]>([]);
  const ownerKey = representatives === null ? "self" : representativeId;

  const slipDataUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (representatives !== null) params.set("user", representativeId);
    return `/api/bills/slip-data?${params}`;
  }, [representatives, representativeId]);

  useEffect(() => {
    if (!ownerKey) {
      setCustomerNames([]);
      return;
    }
    const controller = new AbortController();
    fetch(slipDataUrl(), { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { customerNames: [] }))
      .then((data: { customerNames?: string[] }) => setCustomerNames(data.customerNames ?? []))
      .catch(() => undefined);
    return () => controller.abort();
  }, [ownerKey, slipDataUrl]);

  const drawRestrictions = useMemo(() => {
    const map = new Map<string, SlipRestriction>();
    for (const item of restrictions[drawId] ?? []) map.set(`${item.prizeTypeId}:${item.number}`, item);
    return map;
  }, [restrictions, drawId]);

  const restrictionOf = useCallback((entry: BetEntry) => {
    const rule = rules.get(entry.prizeTypeId);
    return rule ? drawRestrictions.get(entryKey(entry.prizeTypeId, entry.number, rule.matchRule)) : undefined;
  }, [rules, drawRestrictions]);

  const total = entries.reduce((sum, entry) => sum + entry.stake, 0);
  const groupDigits = group?.digits ?? 3;

  const commitNumber = useCallback((numberValue: string) => {
    if (!group) return;
    const selected = group.prizeTypes.filter((prizeType) => selectedIds.includes(prizeType.id));
    if (selected.length === 0) {
      setNotice({ tone: "error", text: "เลือกประเภทอย่างน้อย 1 รายการก่อนกดเลข" });
      return;
    }
    if (amount <= 0) {
      setNotice({ tone: "error", text: "ระบุจำนวนเงินก่อนกดเลข" });
      return;
    }
    const built = buildEntries({ numberValue, stake: amount, selected, reverse });
    const blocked = built.filter((entry) => restrictionOf(entry)?.kind === "CLOSED");
    const accepted = built.filter((entry) => restrictionOf(entry)?.kind !== "CLOSED");
    setEntries((current) => addEntries(current, accepted, rules));
    if (blocked.length > 0) {
      const names = blocked.map((entry) => `${rules.get(entry.prizeTypeId)?.name ?? ""} ${entry.number}`).join(", ");
      setNotice({ tone: "error", text: `เลขเต็ม ปิดรับแล้ว: ${names}` });
    } else {
      const reduced = accepted.filter((entry) => restrictionOf(entry)?.kind === "REDUCED_RATE");
      setNotice({
        tone: "info",
        text: reduced.length > 0
          ? `เพิ่ม ${accepted.length} รายการ · เลขอั้น ${reduced.length} รายการจ่ายตามอัตราที่ลดลง`
          : `เพิ่มเลข ${numberValue} แล้ว ${accepted.length} รายการ`,
      });
    }
  }, [group, selectedIds, amount, reverse, restrictionOf, rules]);

  // เก็บค่าล่าสุดใน ref ด้วย เพราะการกดเลขครบหลักต้องเพิ่มรายการทันทีครั้งเดียว
  // ห้ามทำ side effect ใน state updater ซึ่ง React อาจเรียกซ้ำใน Strict Mode
  const digitsRef = useRef("");
  const writeDigits = useCallback((value: string) => {
    digitsRef.current = value;
    setDigits(value);
  }, []);

  const pressDigit = useCallback((digit: string) => {
    if (!isOpen) return;
    const next = (digitsRef.current + digit).slice(0, groupDigits);
    if (next.length === groupDigits) {
      writeDigits("");
      commitNumber(next);
    } else {
      writeDigits(next);
    }
  }, [isOpen, groupDigits, commitNumber, writeDigits]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (document.querySelector("dialog[open]")) return;
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        pressDigit(event.key);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        writeDigits(digitsRef.current.slice(0, -1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pressDigit, writeDigits]);

  function switchGroup(key: string) {
    setGroupKey(key);
    writeDigits("");
  }

  function toggleOption(prizeTypeId: string) {
    if (!group) return;
    setSelectedByGroup((current) => {
      const list = current[group.key] ?? [];
      return { ...current, [group.key]: list.includes(prizeTypeId) ? list.filter((id) => id !== prizeTypeId) : [...list, prizeTypeId] };
    });
  }

  function updateStake(index: number, raw: string) {
    const value = Math.min(Number(raw.replace(/\D/g, "")) || 0, MAX_STAKE);
    setEntries((current) => current.map((entry, i) => (i === index ? { ...entry, stake: value } : entry)));
  }

  function finishEdit(index: number) {
    setEditing(null);
    setEntries((current) => current.filter((entry, i) => i !== index || entry.stake > 0));
  }

  const needsRepresentative = representatives !== null && !representativeId;
  const checks = [
    { ok: !needsRepresentative, label: "เลือกผู้รับบิล", hidden: representatives === null },
    { ok: title.trim().length > 0, label: "ระบุลูกค้า" },
    { ok: entries.length > 0, label: "เพิ่มตัวเลขลงบิล" },
    { ok: entries.length > 0 && entries.every((entry) => entry.stake > 0), label: "จำนวนเงินครบทุกรายการ" },
  ].filter((check) => !check.hidden);
  const ready = isOpen && checks.every((check) => check.ok) && !pending;

  if (!draw || !group) {
    return <p className="error">ยังไม่มีงวดหรือประเภทรางวัลที่เปิดให้แทง</p>;
  }

  return (
    <form action={placeAction} className="bet-slip bill-create-form">
      <input type="hidden" name="drawId" value={draw.id} />
      <input type="hidden" name="items" value={JSON.stringify(entries)} />
      {representatives !== null && <input type="hidden" name="representativeUserId" value={representativeId} />}

      <header className="bs-header">
        <div className="bs-title">
          <span className="bs-title-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" /><path d="M14 3v5h5" /><path d="M19 8v4" /><path d="M18 16v6M15 19h6" /></svg>
          </span>
          <div>
            <h1>สร้างบิลใหม่</h1>
            <p>เพิ่มรายการเลข ตรวจสอบยอด และยืนยันบิล</p>
          </div>
        </div>
        <div className="bs-draw-bar">
          <div className="bs-draw-panel">
            <label className="bs-draw-select">
              <span className="sr-only">เลือกงวด</span>
              <span className="bs-draw-flag"><ThaiFlag /></span>
              {draws.length > 1 ? (
                <select value={draw.id} onChange={(event) => { setDrawId(event.target.value); setEntries([]); }}>
                  {draws.map((item) => <option key={item.id} value={item.id}>งวด {item.dateLabel}</option>)}
                </select>
              ) : <strong>งวด {draw.dateLabel}</strong>}
            </label>
            <span className={`bs-open-state ${isOpen ? "is-open" : "is-closed"}`}><i aria-hidden="true" />{isOpen ? "เปิดรับ" : "ปิดรับแล้ว"}</span>
            <span className="bs-countdown">
              {isOpen ? <><small>ปิดรับใน</small><Countdown cutoffAt={draw.cutoffAt} /></> : <><small>ปิดรับเมื่อ</small><strong>{draw.cutoffLabel}</strong></>}
            </span>
          </div>
        </div>
      </header>

      {!isOpen && <p className="bs-banner" role="alert"><span aria-hidden="true">i</span>หมดเวลาการเดิมพันสำหรับงวดนี้</p>}

      <div className="bs-layout">
        <section className="bs-card bs-list" aria-labelledby="bs-list-heading">
          <header className="bs-card-head">
            <h2 id="bs-list-heading">รายการในบิล</h2>
            <span className="bs-count">{entries.length} รายการ</span>
          </header>

          <div className="bs-list-fields">
            {representatives !== null && (
              <label className="bs-field">
                <span>ผู้รับบิล / Agent</span>
                <select value={representativeId} onChange={(event) => { setRepresentativeId(event.target.value); setTitle(""); }} disabled={!isOpen}>
                  <option value="">เลือกผู้รับบิล</option>
                  {representatives.map((item) => (
                    <option key={item.id} value={item.id}>{item.displayName} · {item.agentCode ?? item.roleLabel}</option>
                  ))}
                </select>
              </label>
            )}
            <CustomerNameCombobox
              names={customerNames}
              label="ลูกค้า / รหัสอ้างอิง"
              value={title}
              onValueChange={setTitle}
              disabled={!isOpen || needsRepresentative}
              disabledHint={needsRepresentative ? "เลือกผู้รับบิลก่อน" : undefined}
            />
          </div>

          <ol className="bs-entries" aria-label="รายการเลข">
            {entries.length === 0 && (
              <li className="bs-empty">
                <strong>ยังไม่มีรายการ</strong>
                <small>เลือกประเภท ใส่จำนวนเงิน แล้วกดตัวเลข</small>
              </li>
            )}
            {entries.map((entry, index) => {
              const rule = rules.get(entry.prizeTypeId);
              const restriction = restrictionOf(entry);
              return (
                <li key={`${entry.prizeTypeId}:${entry.number}`} className="bs-entry">
                  <span className="bs-entry-main">
                    <span className={`bs-badge bs-badge-${badgeKey(rule)}`}>{rule?.name ?? "-"}</span>
                    <span className="bs-entry-number">{entry.number}</span>
                    {restriction?.kind === "REDUCED_RATE" && <em className="bs-entry-reduced">อั้น {compactRate(restriction.payoutRate ?? "0")}</em>}
                  </span>
                  {editing === index ? (
                    <input
                      className="bs-entry-input"
                      inputMode="numeric"
                      aria-label={`จำนวนเงิน ${entry.number}`}
                      autoFocus
                      value={entry.stake || ""}
                      onChange={(event) => updateStake(index, event.target.value)}
                      onBlur={() => finishEdit(index)}
                      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); finishEdit(index); } }}
                    />
                  ) : (
                    <span className="bs-entry-stake">{money(entry.stake)}</span>
                  )}
                  <span className="bs-entry-actions">
                    <button type="button" className="bs-icon-button" aria-label={`แก้จำนวนเงิน ${entry.number}`} onClick={() => setEditing(editing === index ? null : index)} disabled={!isOpen}>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    <button type="button" className="bs-icon-button is-danger" aria-label={`ลบ ${rule?.name ?? ""} ${entry.number}`} onClick={() => { setEditing(null); setEntries((current) => current.filter((_, i) => i !== index)); }} disabled={!isOpen}>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>

          <footer className="bs-list-foot">
            <div className="bs-list-total"><span>ยอดรวมในบิล</span><strong>{money(total)} บาท</strong></div>
          </footer>
        </section>

        <section className="bs-card bs-pad" aria-label="แป้นแทงเลข">
          <div className="bs-step">
            <h3 className="bs-step-title"><span>1</span>เลือกประเภท</h3>
            <div className="bs-tabs" role="tablist" aria-label="หมวดเลข">
              {groups.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={item.key === group.key}
                  className={`bs-tab bs-tab-${item.key}`}
                  onClick={() => switchGroup(item.key)}
                >
                  <span className="bs-tab-label">{item.label}</span>
                  {item.prizeTypes[0] && <small>จ่าย {compactRate(item.prizeTypes[0].payoutRate)}</small>}
                </button>
              ))}
            </div>
            <div className="bs-options" aria-label="ตัวเลือก">
              {group.prizeTypes.map((prizeType) => (
                <button key={prizeType.id} type="button" aria-pressed={selectedIds.includes(prizeType.id)} className="bs-option" onClick={() => toggleOption(prizeType.id)} disabled={!isOpen}>
                  {prizeType.name}
                </button>
              ))}
              {group.digits >= 2 && (
                <button type="button" aria-pressed={reverse} className="bs-option bs-option-reverse" onClick={() => setReverseByGroup((current) => ({ ...current, [group.key]: !reverse }))} disabled={!isOpen}>
                  ⇄ {reverseLabel(group.digits)}
                </button>
              )}
            </div>
          </div>

          <div className="bs-step">
            <h3 className="bs-step-title"><span>2</span>กำหนดจำนวนเงิน</h3>
            <div className="bs-amount">
              <div className="bs-stepper">
                <button type="button" className="bs-minus" onClick={() => setAmount((value) => Math.max(0, value - 1))} disabled={!isOpen} aria-label="ลดจำนวนเงิน">−</button>
                <input
                  aria-label="จำนวนเงินต่อรายการ"
                  inputMode="numeric"
                  value={amount}
                  disabled={!isOpen}
                  onChange={(event) => setAmount(Math.min(Number(event.target.value.replace(/\D/g, "")) || 0, MAX_STAKE))}
                />
                <button type="button" className="bs-plus" onClick={() => setAmount((value) => Math.min(value + 1, MAX_STAKE))} disabled={!isOpen} aria-label="เพิ่มจำนวนเงิน">+</button>
              </div>
              <div className="bs-chips" aria-label="ชิปเพิ่มจำนวนเงิน">
                {CHIPS.map((chip) => (
                  <button key={chip} type="button" className={`bs-chip bs-chip-${chip}`} onClick={() => setAmount((value) => Math.min(value + chip, MAX_STAKE))} disabled={!isOpen} aria-label={`เพิ่ม ${chip} บาท`}>
                    {chip >= 1000 ? "1K" : chip}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="bs-step">
            <h3 className="bs-step-title"><span>3</span>ใส่ตัวเลข <small>ครบ {groupDigits} หลักแล้วเพิ่มลงบิลทันที</small></h3>
            <div className="bs-digits" aria-live="polite" aria-label={`เลขที่กด ${digits || "ยังไม่มี"}`}>
              {Array.from({ length: groupDigits }, (_, index) => <span key={index} className={digits[index] ? "is-filled" : ""}>{digits[index] ?? ""}</span>)}
            </div>
            <p className={`bs-notice ${notice === null ? "is-idle" : notice.tone === "error" ? "is-error" : ""}`} role="status">{notice?.text ?? " "}</p>
            <div className="bs-keypad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => <button key={digit} type="button" className="bs-key" onClick={() => pressDigit(digit)} disabled={!isOpen}>{digit}</button>)}
              <button type="button" className="bs-key bs-key-muted" onClick={() => writeDigits(digitsRef.current.slice(0, -1))} disabled={!isOpen}>⌫ ลบ</button>
              <button type="button" className="bs-key" onClick={() => pressDigit("0")} disabled={!isOpen}>0</button>
              <button type="button" className="bs-key bs-key-danger" onClick={() => { writeDigits(""); setEntries([]); setNotice(null); }} disabled={!isOpen || (entries.length === 0 && !digits)}>ล้างทั้งหมด</button>
            </div>
          </div>
        </section>

        <aside className="bs-card bs-review" aria-labelledby="bs-review-heading">
          <header className="bs-card-head">
            <h2 id="bs-review-heading"><span className="bs-step-badge">4</span>ยืนยันบิล</h2>
          </header>
          <dl className="bs-summary">
            <div><dt>งวด</dt><dd>{draw.dateLabel}</dd></div>
            {representatives !== null && <div><dt>ผู้รับบิล</dt><dd>{representative?.displayName ?? "ยังไม่เลือก"}</dd></div>}
            <div><dt>ลูกค้า</dt><dd>{title.trim() || "ยังไม่ระบุ"}</dd></div>
            <div><dt>จำนวนรายการ</dt><dd>{entries.length} รายการ</dd></div>
            <div className="is-total"><dt>ยอดแทงรวม</dt><dd>{money(total)} บาท</dd></div>
          </dl>
          <div className="bs-finish-flow" aria-label="ขั้นตอนสุดท้าย">
            <span className="is-current"><b>1</b>ยืนยันบิล</span>
            <i aria-hidden="true">→</i>
            <span><b>2</b>แนบหลักฐาน</span>
          </div>
          {serverError && <p className="bs-error" role="alert">{serverError}</p>}
          <div className="bs-review-actions">
            <button type="submit" className="bs-confirm" disabled={!ready}>
              {placing ? "กำลังยืนยัน…" : "✓ ยืนยันบิล"}
            </button>
          </div>
          <p className="bs-review-note">เมื่อยืนยันแล้ว ระบบจะเปิดหน้าแนบหลักฐานให้ทันที</p>
        </aside>
      </div>

    </form>
  );
}
