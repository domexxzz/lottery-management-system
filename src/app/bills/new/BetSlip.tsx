"use client";

import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  addEntries,
  buildEntries,
  compactRate,
  entryKey,
  groupPrizeTypes,
  MAX_STAKE_PER_ITEM,
  MIN_STAKE_PER_ITEM,
  type BetEntry,
  type BetGroup,
  type BetPrizeType,
} from "@/lib/bills/betting";
import { placeBillAction, type ActionState } from "../actions";
import { clearDraft, newSubmissionKey, readDraft, useServerClockOffset, writeDraft, type SlipDraft, type SlipEntry } from "./slip-safety";
import { CustomerNameCombobox } from "./BillForm";
import { LaoFlag, ThaiFlag } from "../ThaiFlag";
import { RulesDialog } from "./RulesDialog";
import { laoSetPackageLabel, LAO_SET_PACKAGE_PAYOUTS, LAO_SET_PACKAGE_PRICES } from "@/lib/lao/set-package-rates";

const INITIAL: ActionState = { error: null };
const CHIPS = [5, 10, 20, 50, 100, 500, 1000] as const;
const MAX_STAKE = MAX_STAKE_PER_ITEM;

export type SlipDraw = {
  id: string;
  lotteryType: string;
  lotteryLabel: string;
  /** ธงที่แสดงหน้างวด */
  flag?: "TH" | "LA";
  dateLabel: string;
  cutoffAt: string;
  cutoffLabel: string;
  open: boolean;
};

/** ประเภทหวยหนึ่งในบิล: งวดที่เปิดรับและประเภทรางวัลของหวยนั้น */
export type SlipLottery = {
  type: string;
  label: string;
  flag: "TH" | "LA";
  draws: SlipDraw[];
  prizeTypes: BetPrizeType[];
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
  /** ตัวอย่างเลขถัดไปของ Agent ในเดือนปัจจุบัน เลขจริงถูกจองตอนยืนยัน */
  nextBillSequence: number;
};

type Notice = { tone: "info" | "error"; text: string } | null;

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
function Countdown({ cutoffAt, offset }: { cutoffAt: string; offset: number }) {
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
  // นับจากเวลา Server (เครื่อง + offset) นาฬิกามือถือคลาดเท่าไรก็ปิดตรงกับ Server
  const remaining = Math.max(0, Math.floor((new Date(cutoffAt).getTime() - (now + offset)) / 1000));
  const days = Math.floor(remaining / 86_400);
  const clock = [Math.floor((remaining % 86_400) / 3600), Math.floor((remaining % 3600) / 60), remaining % 60]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
  const tone = remaining <= 60 ? "is-urgent" : remaining <= 300 ? "is-soon" : "";
  return <strong className={tone}>{days > 0 ? `${days} วัน ${clock}` : clock}</strong>;
}

/** true จนถึงเวลาปิดรับตามเวลา Server แล้วเปลี่ยนครั้งเดียวด้วย timeout ไม่ต้อง render ทุกวินาที */
function useStillOpen(draw: SlipDraw | undefined, offset: number): boolean {
  const cutoff = draw ? new Date(draw.cutoffAt).getTime() : 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const wait = cutoff - (Date.now() + offset);
    if (wait <= 0) {
      // offset เพิ่งซิงก์แล้วพบว่าเลยเวลาแล้ว: บังคับคำนวณใหม่
      const timer = window.setTimeout(() => setNow(Date.now()), 0);
      return () => window.clearTimeout(timer);
    }
    // setTimeout รองรับได้ราว 24.8 วัน งวดที่ไกลกว่านั้นให้ตรวจซ้ำภายหลัง
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(wait + 50, 2_000_000_000));
    return () => window.clearTimeout(timer);
  }, [cutoff, now, offset]);
  return Boolean(draw?.open && now + offset < cutoff);
}

/** แจ้งเตือนก่อนปิดรับ 5 นาทีและ 1 นาที (ตามเวลา Server) */
function useCutoffAlert(draw: SlipDraw | undefined, offset: number): 5 | 1 | null {
  // ผูกกับงวด เปลี่ยนงวดแล้วคำเตือนของงวดเดิมต้องหายไป
  const [alert, setAlert] = useState<{ drawId: string; level: 5 | 1 } | null>(null);
  useEffect(() => {
    if (!draw?.open) return;
    const cutoff = new Date(draw.cutoffAt).getTime();
    const timers: number[] = [];
    const schedule = (minutes: 5 | 1) => {
      const remainingAtStart = cutoff - (Date.now() + offset);
      if (remainingAtStart <= 0) return;
      const at = remainingAtStart - minutes * 60_000;
      if (at > 2_000_000_000) return;
      timers.push(window.setTimeout(() => setAlert({ drawId: draw.id, level: minutes }), Math.max(0, at)));
    };
    schedule(5);
    schedule(1);
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [draw, offset]);
  return alert && alert.drawId === draw?.id ? alert.level : null;
}

/**
 * ส่งบิลผ่าน Server Action แต่จับกรณีเน็ตหลุดเอง
 * ถ้าปล่อยให้ throw หน้าจะเปลี่ยนเป็นหน้า error และผู้ใช้คิดว่ารายการหาย
 * redirect หลังสร้างบิลสำเร็จเป็น error ภายในของ Next ต้องโยนต่อด้วย unstable_rethrow
 */
async function submitBill(previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    return await placeBillAction(previous, formData);
  } catch (error) {
    unstable_rethrow(error);
    return {
      error: navigator.onLine
        ? "ส่งบิลไม่สำเร็จ การเชื่อมต่อขัดข้อง รายการยังอยู่ครบ กดยืนยันอีกครั้งได้ ระบบกันบิลซ้ำให้"
        : "ไม่มีอินเทอร์เน็ต รายการยังอยู่ครบและเก็บร่างไว้ในเครื่องแล้ว ต่อเน็ตแล้วกดยืนยันอีกครั้ง",
    };
  }
}

function PrizeTypeOptions({
  group,
  selectedIds,
  reverse,
  isOpen,
  isLaoSet = false,
  toggleOption,
  toggleReverse,
}: {
  group: BetGroup;
  selectedIds: string[];
  reverse: boolean;
  isOpen: boolean;
  isLaoSet?: boolean;
  toggleOption: (prizeTypeId: string) => void;
  toggleReverse: () => void;
}) {
  return (
    <div className={`bs-options${isLaoSet ? " is-lao-set" : ""}`} aria-label="เลือกประเภทการแทง">
      {group.prizeTypes.map((prizeType) => (
        <button key={prizeType.id} type="button" aria-pressed={selectedIds.includes(prizeType.id)} className="bs-option" onClick={() => toggleOption(prizeType.id)} disabled={!isOpen}>
          {prizeType.name}
        </button>
      ))}
      {group.digits > 1 && !isLaoSet && (
        <button type="button" aria-pressed={reverse} className="bs-option bs-option-reverse" onClick={toggleReverse} disabled={!isOpen}>
          ⇄ {isLaoSet ? "ตัวสลับ" : "สลับเลข"}
        </button>
      )}
    </div>
  );
}

export function BetSlip({
  lotteries,
  initialLottery,
  restrictions,
  representatives,
  ownNextBillSequence,
  serverNow,
  draftScope,
}: {
  /** ประเภทหวยที่แทงได้ในบิลนี้ บิลเดียวรวมได้หลายประเภท */
  lotteries: SlipLottery[];
  /** ประเภทหวยที่เปิดแท็บไว้ตอนเข้าหน้า */
  initialLottery: string;
  /** เลขอั้น/เลขเต็ม แยกตามงวด */
  restrictions: Record<string, SlipRestriction[]>;
  /** null สำหรับ Agent ซึ่งสร้างบิลให้ตัวเองเท่านั้น */
  representatives: SlipRepresentative[] | null;
  ownCommissionRate: string | null;
  ownNextBillSequence: number;
  /** เวลา Server ตอน render หน้า (ms) จุดตั้งต้นของการเทียบนาฬิกา */
  serverNow: number;
  /** แยกร่างในเครื่องตามผู้ใช้และประเภทหวย เครื่องที่ใช้ร่วมกันจะไม่เห็นร่างของคนอื่น */
  draftScope: string;
}) {
  const [placeState, placeAction, placing] = useActionState(submitBill, INITIAL);
  const pending = placing;

  // ---------------------------------------------------------------- ประเภทหวยในบิล
  // บิลเดียวแทงได้หลายประเภทหวย แท็บด้านบนสลับแป้นไปยังหวยแต่ละประเภท
  // รายการทุกประเภทอยู่ในบิลเดียวกัน แต่ละรายการรู้งวดของตัวเอง
  const [activeType, setActiveType] = useState(() =>
    lotteries.some((item) => item.type === initialLottery) ? initialLottery : lotteries[0]?.type ?? "");
  const lottery = lotteries.find((item) => item.type === activeType) ?? lotteries[0];
  const isLaoSet = lottery?.type === "LAO_SET";
  const draws = useMemo(() => lottery?.draws ?? [], [lottery]);
  const prizeTypes = useMemo(() => lottery?.prizeTypes ?? [], [lottery]);
  // รหัสประเภทรางวัลไม่ซ้ำข้ามประเภทหวย จึงใช้แผนที่เดียวสำหรับทุกรายการในบิล
  const rules = useMemo(() => new Map(lotteries.flatMap((item) => item.prizeTypes).map((prizeType) => [prizeType.id, prizeType])), [lotteries]);
  const lotteryByPrize = useMemo(() => new Map(lotteries.flatMap((item) => item.prizeTypes.map((prizeType) => [prizeType.id, item] as const))), [lotteries]);
  const drawById = useMemo(() => new Map(lotteries.flatMap((item) => item.draws).map((item) => [item.id, item])), [lotteries]);
  const groups = useMemo(() => groupPrizeTypes(prizeTypes), [prizeTypes]);

  const clockOffset = useServerClockOffset(serverNow);
  const [drawByType, setDrawByType] = useState<Record<string, string>>(() =>
    Object.fromEntries(lotteries.map((item) => [item.type, item.draws[0]?.id ?? ""])));
  const drawId = (lottery && drawByType[lottery.type]) || draws[0]?.id || "";
  const draw = draws.find((item) => item.id === drawId) ?? draws[0];
  const isOpen = useStillOpen(draw, clockOffset);
  const cutoffAlert = useCutoffAlert(draw, clockOffset);

  const [representativeId, setRepresentativeId] = useState("");
  const representative = representatives?.find((item) => item.id === representativeId);
  const previewBillSequence = representatives === null
    ? ownNextBillSequence
    : representative?.nextBillSequence ?? null;

  // หมวดเลขและตัวเลือกจำแยกตามประเภทหวย สลับแท็บไปมาแล้วค่ายังอยู่
  const [groupKeyByType, setGroupKeyByType] = useState<Record<string, string>>({});
  const defaultGroupKey = groups.find((item) => item.digits === 3)?.key ?? groups[0]?.key ?? "";
  const groupKey = (lottery && groupKeyByType[lottery.type]) || defaultGroupKey;
  const group = groups.find((item) => item.key === groupKey) ?? groups[0];
  const optionKey = `${lottery?.type ?? ""}:${group?.key ?? ""}`;
  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, string[]>>({});
  const [reverseByGroup, setReverseByGroup] = useState<Record<string, boolean>>({});
  const selectedIds = group ? selectedByGroup[optionKey] ?? (group.prizeTypes[0] ? [group.prizeTypes[0].id] : []) : [];
  const reverse = group ? reverseByGroup[optionKey] ?? false : false;

  // หวยลาวชุดเป็นราคาเหมา 30/60/120 ส่วนหวยอื่นเริ่มที่ยอดขั้นต่ำและพิมพ์เองได้
  const [amount, setAmount] = useState<number>(() => initialLottery === "LAO_SET" ? LAO_SET_PACKAGE_PRICES[0] : MIN_STAKE_PER_ITEM);
  const [digits, setDigits] = useState("");
  const [entries, setEntries] = useState<SlipEntry[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  // ---------------------------------------------------------------- กันกดยืนยันซ้ำ
  // รหัสนี้ส่งไปกับบิล Server เห็นรหัสเดิมซ้ำจะคืนบิลเดิมแทนการสร้างใหม่
  // ใส่ค่าใน ref ตอนส่ง ไม่ render ลง HTML ฝั่ง server จะได้ไม่ชนตอน hydrate
  const submissionKeyRef = useRef("");
  const keyInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  useEffect(() => {
    if (!submissionKeyRef.current) submissionKeyRef.current = newSubmissionKey();
  }, []);
  useEffect(() => {
    if (!placing) submittingRef.current = false;
  }, [placing]);

  // ---------------------------------------------------------------- เลขที่ Server ปฏิเสธตอนยืนยัน
  const [seenPlaceState, setSeenPlaceState] = useState(placeState);
  const rejectedReasons = useMemo(
    () => new Map((placeState.rejected ?? []).map((item) => [`${item.prizeTypeId}:${item.number}`, item.reason.replace(/^รายการที่ \d+:\s*/, "")])),
    [placeState],
  );
  const rejectedCount = entries.filter((entry) => rejectedReasons.has(`${entry.prizeTypeId}:${entry.number}`)).length;
  // ถ้าเลขที่ถูกปฏิเสธถูกลบออกหมดแล้ว ข้อความเดิมก็ไม่ต้องแสดงต่อ
  const serverError = placeState.rejected?.length
    ? rejectedCount > 0 ? `มี ${rejectedCount} รายการที่รับไม่ได้ ลบหรือแก้รายการที่ไฮไลต์สีแดง แล้วกดยืนยันอีกครั้ง` : null
    : placeState.error;

  // ---------------------------------------------------------------- ร่างบิลในเครื่อง
  const [offeredDraft, setOfferedDraft] = useState<SlipDraft | null>(null);
  const [draftChecked, setDraftChecked] = useState(false);
  const openDrawIds = lotteries.flatMap((item) => item.draws).filter((item) => item.open).map((item) => item.id).join(",");
  useEffect(() => {
    // อ่าน localStorage หลัง mount เท่านั้น ฝั่ง server ไม่มี
    const timer = window.setTimeout(() => {
      const saved = readDraft(draftScope);
      // กู้คืนได้เฉพาะรายการของงวดที่ยังเปิดรับ
      const open = new Set(openDrawIds.split(","));
      const usable = saved ? { ...saved, entries: saved.entries.filter((entry) => open.has(entry.drawId)) } : null;
      if (usable && usable.entries.length > 0) setOfferedDraft(usable);
      else if (saved) clearDraft(draftScope);
      setDraftChecked(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftScope, openDrawIds]);

  useEffect(() => {
    // ระหว่างถามว่าจะกู้คืนไหม ห้ามเขียนทับร่างเดิมด้วยบิลว่าง
    if (!draftChecked || offeredDraft) return;
    const timer = window.setTimeout(() => {
      if (entries.length === 0) {
        clearDraft(draftScope);
        return;
      }
      writeDraft(draftScope, {
        version: 2,
        activeType,
        entries,
        title,
        representativeId,
        submissionKey: submissionKeyRef.current,
        savedAt: Date.now(),
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draftChecked, offeredDraft, entries, title, representativeId, activeType, draftScope]);

  function restoreDraft() {
    if (!offeredDraft) return;
    // เลือกงวดตามรายการที่กู้คืน และเปิดแท็บประเภทหวยเดิม
    const restoredDraws: Record<string, string> = {};
    for (const entry of offeredDraft.entries) {
      const owner = lotteries.find((item) => item.draws.some((row) => row.id === entry.drawId));
      if (owner) restoredDraws[owner.type] = entry.drawId;
    }
    setDrawByType((current) => ({ ...current, ...restoredDraws }));
    if (lotteries.some((item) => item.type === offeredDraft.activeType)) setActiveType(offeredDraft.activeType);
    setEntries(offeredDraft.entries);
    setTitle(offeredDraft.title);
    if (representatives?.some((item) => item.id === offeredDraft.representativeId)) setRepresentativeId(offeredDraft.representativeId);
    // ใช้รหัสเดิม: ถ้ารอบก่อน Server สร้างบิลไปแล้วแต่เน็ตหลุดก่อนเห็นผล จะได้บิลเดิมคืน ไม่เกิดบิลซ้ำ
    if (offeredDraft.submissionKey) submissionKeyRef.current = offeredDraft.submissionKey;
    setNotice({ tone: "info", text: `กู้คืน ${offeredDraft.entries.length} รายการแล้ว ตรวจรายการแล้วกดยืนยันบิล` });
    setOfferedDraft(null);
  }

  function discardDraft() {
    clearDraft(draftScope);
    setOfferedDraft(null);
  }

  // มือถือ: รายการในบิลเปิดเป็น Bottom Sheet จากแถบยืนยันด้านล่าง ไม่ต้องเลื่อนออกจากแป้น
  // บนจอใหญ่ CSS แสดงรายการค้างไว้ตามเดิม state นี้จึงไม่มีผล
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetCloseRef = useRef<HTMLButtonElement>(null);
  const peekRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // ผลยืนยันรอบใหม่มีเลขถูกปฏิเสธ: เปิดรายการให้เห็นทันทีว่าต้องแก้เลขไหน (ปรับ state ระหว่าง render ตามแนวทางของ React)
  if (seenPlaceState !== placeState) {
    setSeenPlaceState(placeState);
    if (placeState.rejected?.length) setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setEditing(null);
    peekRef.current?.focus();
  }

  useEffect(() => {
    if (!sheetOpen) return;
    sheetCloseRef.current?.focus();
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSheetOpen(false);
        setEditing(null);
        peekRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [sheetOpen]);

  // iOS ไม่ย่อ layout viewport ตอนคีย์บอร์ดขึ้น แถบที่ติดด้านล่างจึงถูกคีย์บอร์ดบัง
  // วัดส่วนที่คีย์บอร์ดกินจาก visualViewport แล้วยกแถบยืนยันและ Bottom Sheet ขึ้นตาม
  useEffect(() => {
    const viewport = window.visualViewport;
    const form = formRef.current;
    if (!viewport || !form) return;
    const update = () => {
      // ตอนผู้ใช้ซูมหน้าจอ ความสูงที่หายไปไม่ใช่คีย์บอร์ด ไม่ต้องยก
      const offset = viewport.scale > 1.01 ? 0 : Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      form.style.setProperty("--bs-keyboard-offset", `${Math.round(offset)}px`);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

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

  // เลขอั้น/เลขเต็มแยกตามงวด แต่ละรายการดูของงวดตัวเอง
  const restrictionsByDraw = useMemo(() => {
    const byDraw = new Map<string, Map<string, SlipRestriction>>();
    for (const [id, rows] of Object.entries(restrictions)) {
      byDraw.set(id, new Map(rows.map((item) => [`${item.prizeTypeId}:${item.number}`, item])));
    }
    return byDraw;
  }, [restrictions]);

  const restrictionOf = useCallback((entry: BetEntry, entryDrawId: string) => {
    const rule = rules.get(entry.prizeTypeId);
    return rule ? restrictionsByDraw.get(entryDrawId)?.get(entryKey(entry.prizeTypeId, entry.number, rule.matchRule)) : undefined;
  }, [rules, restrictionsByDraw]);

  const total = entries.reduce((sum, entry) => sum + entry.stake, 0);
  const groupDigits = group?.digits ?? 3;

  const commitNumber = useCallback((numberValue: string) => {
    if (!group) return;
    const selected = group.prizeTypes.filter((prizeType) => selectedIds.includes(prizeType.id));
    if (selected.length === 0) {
      setNotice({ tone: "error", text: "เลือกประเภทอย่างน้อย 1 รายการก่อนกดเลข" });
      return;
    }
    if (amount < MIN_STAKE_PER_ITEM) {
      setNotice({ tone: "error", text: `จำนวนเงินเดิมพันขั้นต่ำ ${MIN_STAKE_PER_ITEM} บาท` });
      return;
    }
    if (isLaoSet && !LAO_SET_PACKAGE_PRICES.some((price) => price === amount)) {
      setNotice({ tone: "error", text: `หวยลาวชุดเลือกราคาได้เฉพาะ ${LAO_SET_PACKAGE_PRICES.join(" / ")} บาท` });
      return;
    }
    if (!draw) return;
    const targetDraw = draw.id;
    const built = buildEntries({ numberValue, stake: amount, selected, reverse });
    const blocked = built.filter((entry) => restrictionOf(entry, targetDraw)?.kind === "CLOSED");
    const accepted = built.filter((entry) => restrictionOf(entry, targetDraw)?.kind !== "CLOSED");
    // รวมยอดเลขซ้ำเฉพาะในงวดเดียวกัน รายการของประเภทหวยอื่นในบิลไม่ถูกแตะ
    setEntries((current) => {
      const sameDraw = current.filter((entry) => entry.drawId === targetDraw);
      // ราคาหวยลาวชุดเป็นแพ็กเกจ: กดเลขเดิมซ้ำให้เปลี่ยนแพ็กเกจ ไม่บวกจนเกิดราคาที่ไม่อนุญาต
      const merged = isLaoSet
        ? [
            ...sameDraw.filter((existing) => !accepted.some((next) => {
              const rule = rules.get(next.prizeTypeId);
              return rule
                && existing.stake === next.stake
                && entryKey(existing.prizeTypeId, existing.number, rules.get(existing.prizeTypeId)?.matchRule ?? "EXACT") === entryKey(next.prizeTypeId, next.number, rule.matchRule);
            })),
            ...accepted,
          ].map((entry) => ({ ...entry, drawId: targetDraw }))
        : addEntries(sameDraw, accepted, rules).map((entry) => ({ ...entry, drawId: targetDraw }));
      return [...current.filter((entry) => entry.drawId !== targetDraw), ...merged];
    });
    if (blocked.length > 0) {
      const names = blocked.map((entry) => `${rules.get(entry.prizeTypeId)?.name ?? ""} ${entry.number}`).join(", ");
      setNotice({ tone: "error", text: `เลขเต็ม ปิดรับแล้ว: ${names}` });
    } else {
      const reduced = accepted.filter((entry) => restrictionOf(entry, targetDraw)?.kind === "REDUCED_RATE");
      setNotice({
        tone: "info",
        text: reduced.length > 0
          ? `เพิ่ม ${accepted.length} รายการ · เลขอั้น ${reduced.length} รายการจ่ายตามอัตราที่ลดลง`
          : `เพิ่มเลข ${numberValue} แล้ว ${accepted.length} รายการ`,
      });
    }
  }, [group, selectedIds, amount, reverse, restrictionOf, rules, draw, isLaoSet]);

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
      if (document.querySelector("dialog[open], .bs-sheet.is-open")) return;
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
    if (lottery) setGroupKeyByType((current) => ({ ...current, [lottery.type]: key }));
    writeDigits("");
  }

  function switchLottery(type: string) {
    if (type === activeType) return;
    setActiveType(type);
    if (type === "LAO_SET" && !LAO_SET_PACKAGE_PRICES.some((price) => price === amount)) setAmount(LAO_SET_PACKAGE_PRICES[0]);
    writeDigits("");
    setNotice(null);
  }

  function toggleOption(prizeTypeId: string) {
    if (!group) return;
    setSelectedByGroup((current) => {
      const list = current[optionKey] ?? selectedIds;
      return { ...current, [optionKey]: list.includes(prizeTypeId) ? list.filter((id) => id !== prizeTypeId) : [...list, prizeTypeId] };
    });
  }

  function updateStake(index: number, raw: string) {
    const value = Math.min(Number(raw.replace(/\D/g, "")) || 0, MAX_STAKE);
    setEntries((current) => current.map((entry, i) => (i === index ? { ...entry, stake: value } : entry)));
  }

  function finishEdit(index: number) {
    setEditing(null);
    setEntries((current) => current
      .map((entry, i) => i === index && entry.stake > 0 && entry.stake < MIN_STAKE_PER_ITEM
        ? { ...entry, stake: MIN_STAKE_PER_ITEM }
        : entry)
      .filter((entry, i) => i !== index || entry.stake > 0));
  }

  function removeRejected() {
    setEditing(null);
    setEntries((current) => current.filter((entry) => !rejectedReasons.has(`${entry.prizeTypeId}:${entry.number}`)));
    setNotice({ tone: "info", text: `ลบ ${rejectedCount} รายการที่รับไม่ได้แล้ว ตรวจรายการที่เหลือแล้วกดยืนยันอีกครั้ง` });
  }

  /** เปลี่ยนงวดหรือล้างบิลทำให้รายการหาย ถามก่อนเสมอเมื่อมีรายการค้าง */
  function confirmDiscard(action: string, count = entries.length): boolean {
    return count === 0 || window.confirm(`${action}จะลบรายการที่แทงไว้ ${count} รายการ ต้องการทำต่อหรือไม่?`);
  }

  function changeDraw(nextDrawId: string) {
    if (!lottery || !draw) return;
    const affected = entries.filter((entry) => entry.drawId === draw.id).length;
    if (!confirmDiscard(`เปลี่ยนงวด${lottery.label}`, affected)) return;
    setDrawByType((current) => ({ ...current, [lottery.type]: nextDrawId }));
    setEntries((current) => current.filter((entry) => entry.drawId !== draw.id));
  }

  // ---------------------------------------------------------------- จัดกลุ่มรายการตามประเภทหวย/งวด
  const entryGroups = useMemo(() => {
    const order = lotteries.flatMap((item) => item.draws.map((row) => row.id));
    const groupsByDraw = new Map<string, { index: number; entry: SlipEntry }[]>();
    entries.forEach((entry, index) => {
      groupsByDraw.set(entry.drawId, [...(groupsByDraw.get(entry.drawId) ?? []), { index, entry }]);
    });
    return [...groupsByDraw.entries()]
      .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
      .map(([id, rows]) => {
        const rowDraw = drawById.get(id);
        const owner = lotteries.find((item) => item.draws.some((row) => row.id === id));
        return { drawId: id, draw: rowDraw, lottery: owner, rows, total: rows.reduce((sum, row) => sum + row.entry.stake, 0) };
      });
  }, [entries, lotteries, drawById]);
  const countByType = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const entry of entries) {
      const owner = lotteryByPrize.get(entry.prizeTypeId);
      if (owner) counts[owner.type] = (counts[owner.type] ?? 0) + 1;
    }
    return counts;
  }, [entries, lotteryByPrize]);
  // งวดที่มีรายการแต่ปิดรับไปแล้ว ส่งบิลไม่ได้จนกว่าจะลบรายการของงวดนั้น
  const closedEntryGroups = entryGroups.filter((row) => !row.draw?.open);

  // ---------------------------------------------------------------- เตือนก่อนออกจากหน้า
  // ปิดแท็บ/รีเฟรช ใช้ beforeunload ส่วนลิงก์ในแอป (เมนู เปลี่ยนประเภทหวย breadcrumb) ดักคลิกก่อน Next.js
  // ปุ่มย้อนกลับของเบราว์เซอร์ดักไม่ได้ จึงมีร่างในเครื่องไว้กู้คืนอีกชั้น
  const unsavedCount = placing ? 0 : entries.length;
  useEffect(() => {
    if (unsavedCount === 0) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      const leave = window.confirm(
        `มีรายการที่ยังไม่ยืนยัน ${unsavedCount} รายการ\nรายการถูกเก็บเป็นร่างในเครื่องนี้ กลับมาที่หน้าสร้างบิลจะถามให้กู้คืน\n\nออกจากหน้านี้หรือไม่?`,
      );
      if (!leave) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [unsavedCount]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // ล็อกทันทีที่กด ก่อน React จะเริ่มสถานะ pending กันการแตะสองครั้งติดบนมือถือ
    if (submittingRef.current || !ready) {
      event.preventDefault();
      return;
    }
    submittingRef.current = true;
    if (keyInputRef.current) keyInputRef.current.value = submissionKeyRef.current;
  }

  const needsRepresentative = representatives !== null && !representativeId;
  const checks = [
    { ok: !needsRepresentative, label: "เลือกผู้รับบิล", hidden: representatives === null },
    { ok: title.trim().length > 0, label: "ระบุลูกค้า" },
    { ok: entries.length > 0, label: "เพิ่มตัวเลขลงบิล" },
    {
      ok: entries.length > 0 && entries.every((entry) => {
        const owner = lotteryByPrize.get(entry.prizeTypeId);
        return owner?.type === "LAO_SET"
          ? LAO_SET_PACKAGE_PRICES.some((price) => price === entry.stake)
          : entry.stake >= MIN_STAKE_PER_ITEM;
      }),
      label: "ตรวจจำนวนเงินของแต่ละรายการ",
    },
    { ok: closedEntryGroups.length === 0, label: `ลบรายการของงวดที่ปิดรับแล้ว (${closedEntryGroups.map((row) => row.lottery?.label ?? "").join(", ")})`, hidden: closedEntryGroups.length === 0 },
  ].filter((check) => !check.hidden);
  // ส่งบิลได้เมื่อทุกงวดที่มีรายการยังเปิดรับ แท็บที่เปิดอยู่ปิดรับแล้วก็ยังส่งรายการของหวยอื่นได้
  const ready = checks.every((check) => check.ok) && !pending;
  // แถบยืนยันบนมือถือบอกสิ่งที่ยังขาด ผู้ใช้จะได้ไม่แทงครบแล้วเพิ่งรู้ว่ายังไม่เลือก Agent
  const missing = checks.find((check) => !check.ok);
  const typesInSlip = entryGroups.length;
  const peekHint = missing ? `ยังขาด: ${missing.label}` : typesInSlip > 1 ? `${typesInSlip} ประเภทหวยในบิลเดียว · แตะเพื่อดูรายการ` : "แตะเพื่อดูและแก้รายการ";

  if (!draw || !group) {
    return <p className="error">ยังไม่มีงวดหรือประเภทรางวัลที่เปิดให้แทง</p>;
  }

  return (
    <form ref={formRef} action={placeAction} onSubmit={onSubmit} className="bet-slip bill-create-form" aria-busy={placing}>
      <input ref={keyInputRef} type="hidden" name="submissionKey" defaultValue="" />
      <input
        type="hidden"
        name="parts"
        value={JSON.stringify(entryGroups.map((row) => ({
          drawId: row.drawId,
          items: row.rows.map(({ entry }) => ({ prizeTypeId: entry.prizeTypeId, number: entry.number, stake: entry.stake })),
        })))}
      />
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
        {lotteries.length > 1 && (
          <div className="bs-lottery-picker">
            <p><strong>เพิ่มประเภทหวยในบิลเดียว</strong><span>เลือกแท็บแล้วใส่เลข รายการเดิมจะไม่หาย</span></p>
            <nav className="bs-lottery-tabs" role="tablist" aria-label="ประเภทหวยในบิลนี้">
              {lotteries.map((item) => {
                const open = item.draws.some((row) => row.open);
                return (
                  <button
                    key={item.type}
                    type="button"
                    role="tab"
                    aria-selected={item.type === activeType}
                    className={`bs-lottery-tab is-${item.type.toLowerCase()}${open ? "" : " is-closed"}`}
                    onClick={() => switchLottery(item.type)}
                    disabled={!open}
                  >
                    <span className="bs-lottery-tab-flag" aria-hidden="true">{item.flag === "LA" ? <LaoFlag /> : <ThaiFlag />}</span>
                    <span>{item.type === "THAI_GOVERNMENT" ? "หวยไทย" : item.label}<small><i aria-hidden="true" />{open ? "เปิดรับ" : "ปิดรับแล้ว"}</small></span>
                    {countByType[item.type] ? <b aria-label={`${countByType[item.type]} รายการ`}>{countByType[item.type]}</b> : null}
                  </button>
                );
              })}
            </nav>
          </div>
        )}
        <div className="bs-draw-bar">
          <RulesDialog
            lotteryType={draw.lotteryType}
            lotteryLabel={draw.lotteryLabel}
            drawLabel={draw.dateLabel}
            cutoffLabel={draw.cutoffLabel}
            prizeTypes={prizeTypes}
            restrictions={restrictions[draw.id] ?? []}
          />
          <div className="bs-draw-panel">
            <label className="bs-draw-select">
              <span className="sr-only">เลือกงวด{draw.lotteryLabel}</span>
              <span className="bs-draw-flag">{draw?.flag === "LA" ? <LaoFlag /> : <ThaiFlag />}</span>
              {draws.length > 1 ? (
                <select value={draw.id} onChange={(event) => changeDraw(event.target.value)}>
                  {draws.map((item) => <option key={item.id} value={item.id}>{lotteries.length > 1 ? `${item.lotteryLabel} ` : ""}งวด {item.dateLabel}</option>)}
                </select>
              ) : <strong>{lotteries.length > 1 ? `${draw.lotteryLabel} ` : ""}งวด {draw.dateLabel}</strong>}
            </label>
            <span className={`bs-open-state ${isOpen ? "is-open" : "is-closed"}`}><i aria-hidden="true" />{isOpen ? "เปิดรับ" : "ปิดรับแล้ว"}</span>
            <span className="bs-countdown">
              {isOpen ? <><small>ปิดรับใน</small><Countdown cutoffAt={draw.cutoffAt} offset={clockOffset} /></> : <><small>ปิดรับเมื่อ</small><strong>{draw.cutoffLabel}</strong></>}
            </span>
          </div>
        </div>
      </header>

      {!isOpen && <p className="bs-banner" role="alert"><span aria-hidden="true">i</span>หมดเวลาการเดิมพันสำหรับ{draw.lotteryLabel}งวดนี้{lotteries.length > 1 ? " เลือกประเภทหวยอื่นจากแท็บด้านบนได้" : ""}</p>}
      {isOpen && cutoffAlert !== null && (
        <p className={`bs-cutoff-alert ${cutoffAlert === 1 ? "is-urgent" : ""}`} role="alert">
          <span aria-hidden="true">⏰</span>
          {cutoffAlert === 1
            ? "เหลือไม่ถึง 1 นาทีจะปิดรับ ยืนยันบิลตอนนี้ บิลที่ส่งหลังปิดรับจะไม่ถูกรับ"
            : "อีกไม่ถึง 5 นาทีจะปิดรับ ตรวจรายการแล้วกดยืนยันบิลก่อนหมดเวลา"}
        </p>
      )}
      {offeredDraft && (
        <div className="bs-draft-offer" role="alert">
          <div>
            <strong>พบบิลที่ยังไม่ได้ยืนยัน</strong>
            <small>
              {offeredDraft.entries.length} รายการ · {money(offeredDraft.entries.reduce((sum, entry) => sum + entry.stake, 0))} บาท
              {offeredDraft.title ? ` · ${offeredDraft.title}` : ""} · บันทึกไว้ {new Date(offeredDraft.savedAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
            </small>
          </div>
          <span>
            <button type="button" className="bs-draft-discard" onClick={discardDraft}>ทิ้ง</button>
            <button type="button" className="bs-draft-restore" onClick={restoreDraft}>กู้คืน</button>
          </span>
        </div>
      )}

      <div className="bs-layout">
        <section className="bs-card bs-list" aria-labelledby="bs-list-heading">
          <header className="bs-card-head">
            <h2 id="bs-list-heading">รายการในบิล</h2>
            <span className="bs-count">{entries.length} รายการ</span>
          </header>

          <div className="bs-list-fields">
            <label className="bs-field bs-sequence-field">
              <span>เลขบิล</span>
              <output aria-live="polite" aria-label="เลขบิลถัดไป อ่านอย่างเดียว">
                {previewBillSequence === null ? "เลือก Agent ก่อน" : `บิล ${previewBillSequence}`}
              </output>
              <small>ระบบกำหนดอัตโนมัติ แก้ไขไม่ได้</small>
            </label>
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
              label="ชื่อลูกค้า"
              value={title}
              onValueChange={setTitle}
              disabled={!isOpen || needsRepresentative}
              disabledHint={needsRepresentative ? "เลือกผู้รับบิลก่อน" : undefined}
            />
          </div>

          {sheetOpen && <button type="button" className="bs-sheet-backdrop" aria-label="ปิดรายการในบิล" tabIndex={-1} onClick={closeSheet} />}
          {/* จอใหญ่: wrapper นี้เป็น display: contents รายการจึงอยู่ในการ์ดเหมือนเดิม
              มือถือ: กลายเป็น Bottom Sheet ที่เปิดจากแถบยืนยันด้านล่าง */}
          <div
            id="bs-sheet"
            className={`bs-sheet ${sheetOpen ? "is-open" : ""}`}
            role={sheetOpen ? "dialog" : undefined}
            aria-modal={sheetOpen ? true : undefined}
            aria-labelledby={sheetOpen ? "bs-sheet-heading" : undefined}
          >
          <header className="bs-sheet-head">
            <span className="bs-sheet-grip" aria-hidden="true" />
            <div>
              <h2 id="bs-sheet-heading">รายการในบิล</h2>
              <small>{entries.length} รายการ{previewBillSequence !== null ? ` · บิล ${previewBillSequence}` : ""}{title.trim() ? ` · ${title.trim()}` : ""}</small>
            </div>
            <button ref={sheetCloseRef} type="button" className="bs-sheet-close" aria-label="ปิดรายการในบิล" onClick={closeSheet}>×</button>
          </header>
          <ol className="bs-entries" aria-label="รายการเลข">
            {entries.length === 0 && (
              <li className="bs-empty">
                <strong>ยังไม่มีรายการ</strong>
                <small>{isLaoSet ? "เลือกราคาชุด แล้วกรอกเลข 4 หลัก" : "เลือกประเภท ใส่จำนวนเงิน แล้วกดตัวเลข"}</small>
              </li>
            )}
            {entryGroups.flatMap((section) => [
              <li key={`group:${section.drawId}`} className={`bs-entry-group is-${section.lottery?.type.toLowerCase() ?? "x"}`}>
                <span className="bs-entry-group-flag" aria-hidden="true">{section.lottery?.flag === "LA" ? <LaoFlag /> : <ThaiFlag />}</span>
                <strong>{section.lottery?.label ?? "งวดอื่น"}</strong>
                <small>งวด {section.draw?.dateLabel ?? "-"}{section.draw && !section.draw.open ? " · ปิดรับแล้ว" : ""}</small>
                <span>{section.rows.length} รายการ · {money(section.total)}</span>
              </li>,
              ...section.rows.map(({ entry, index }) => {
              const rule = rules.get(entry.prizeTypeId);
              const restriction = restrictionOf(entry, entry.drawId);
              const rejectedReason = rejectedReasons.get(`${entry.prizeTypeId}:${entry.number}`);
              return (
                <li key={`${entry.drawId}:${entry.prizeTypeId}:${entry.number}:${entry.stake}`} className={`bs-entry is-${section.lottery?.type.toLowerCase() ?? "x"} ${restriction?.kind === "REDUCED_RATE" ? "is-restricted" : ""} ${rejectedReason ? "is-rejected" : ""}`}>
                  <span className="bs-entry-main">
                    <span className={`bs-badge bs-badge-${badgeKey(rule)}`}>{rule?.name ?? "-"}</span>
                    {section.lottery?.type === "LAO_SET" && <em className="bs-entry-package">{laoSetPackageLabel(entry.stake)}</em>}
                    <span className="bs-entry-number">{entry.number}</span>
                    {restriction?.kind === "REDUCED_RATE" && <em className="bs-entry-reduced">อั้น {compactRate(restriction.payoutRate ?? "0")}</em>}
                    {rejectedReason && <small className="bs-entry-rejected">รับไม่ได้: {rejectedReason}</small>}
                  </span>
                  {editing === index && section.lottery?.type !== "LAO_SET" ? (
                    <input
                      className="bs-entry-input"
                      inputMode="numeric"
                      min={MIN_STAKE_PER_ITEM}
                      max={MAX_STAKE}
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
                    {section.lottery?.type !== "LAO_SET" && (
                      <button type="button" className="bs-icon-button" aria-label={`แก้จำนวนเงิน ${entry.number}`} onClick={() => setEditing(editing === index ? null : index)} disabled={placing}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                      </button>
                    )}
                    <button type="button" className="bs-icon-button is-danger" aria-label={`ลบ ${section.lottery?.label ?? ""} ${rule?.name ?? ""} ${entry.number}`} onClick={() => { setEditing(null); setEntries((current) => current.filter((_, i) => i !== index)); }} disabled={placing}>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>
                    </button>
                  </span>
                </li>
              );
              }),
            ])}
          </ol>

          <footer className="bs-list-foot">
            <div className="bs-list-total"><span>ยอดรวมในบิล</span><strong>{money(total)} บาท</strong></div>
            {rejectedCount > 0 && (
              <button type="button" className="bs-remove-rejected" onClick={removeRejected} disabled={placing}>
                ลบ {rejectedCount} รายการที่รับไม่ได้
              </button>
            )}
            {missing && isOpen && <p className="bs-sheet-missing">ยังขาด: {missing.label}</p>}
            <button type="submit" className="bs-confirm bs-sheet-confirm" disabled={!ready}>
              {placing ? "กำลังสร้างบิล…" : "✓ ยืนยันบิล"}
            </button>
          </footer>
          </div>
        </section>

        <section className="bs-card bs-pad" aria-label="แป้นแทงเลข">
          <div className="bs-step">
            <h3 className="bs-step-title"><span>1</span>{isLaoSet ? "เลือกราคา" : "เลือกประเภท"}</h3>
            {isLaoSet ? (
              <>
                <p className="bs-step-help">ราคาต่อชุดกำหนดไว้แล้ว เลือกครั้งละ 1 ราคา และเพิ่มชุด 30/60/120 บาทไว้ในบิลเดียวกันได้</p>
                <div className="bs-lao-packages" role="group" aria-label="เลือกราคาหวยลาวชุด">
                  {LAO_SET_PACKAGE_PAYOUTS.map((item) => (
                    <button key={item.price} type="button" className={amount === item.price ? "is-active" : ""} aria-pressed={amount === item.price} onClick={() => setAmount(item.price)} disabled={!isOpen}>
                      <strong>{item.price} บาท</strong>
                      <span className="bs-lao-package-rates">
                        <span>ลุ้น 8 รางวัล <b>สูงสุด {item.exact.toLocaleString("th-TH")}</b></span>
                        <span>จ่ายรางวัลที่สูงที่สุดเพียง 1 รางวัล</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
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
                <PrizeTypeOptions
                  group={group}
                  selectedIds={selectedIds}
                  reverse={reverse}
                  isOpen={isOpen}
                  toggleOption={toggleOption}
                  toggleReverse={() => setReverseByGroup((current) => ({ ...current, [optionKey]: !reverse }))}
                />
              </>
            )}
          </div>

          <div className="bs-step">
            <h3 className="bs-step-title"><span>2</span>{isLaoSet ? "เลือกประเภท" : "กำหนดจำนวนเงิน"}</h3>
            {isLaoSet ? (
              <>
                <p className="bs-step-help">เลือก 4 ตัวตรงเพียงรายการเดียว เลขชุด 4 หลักนี้จะลุ้น 8 รางวัล และจ่ายเฉพาะรางวัลที่สูงที่สุด</p>
                <PrizeTypeOptions
                  group={group}
                  selectedIds={selectedIds}
                  reverse={reverse}
                  isOpen={isOpen}
                  isLaoSet
                  toggleOption={toggleOption}
                  toggleReverse={() => setReverseByGroup((current) => ({ ...current, [optionKey]: !reverse }))}
                />
              </>
            ) : (
              <div className="bs-amount">
                <div className="bs-stepper">
                  <button type="button" className="bs-minus" onClick={() => setAmount((value) => Math.max(MIN_STAKE_PER_ITEM, value - 1))} disabled={!isOpen} aria-label="ลดจำนวนเงิน">−</button>
                  <input aria-label="จำนวนเงินต่อรายการ" inputMode="numeric" min={MIN_STAKE_PER_ITEM} max={MAX_STAKE} value={amount} disabled={!isOpen} onChange={(event) => setAmount(Math.min(Number(event.target.value.replace(/\D/g, "")) || 0, MAX_STAKE))} onBlur={() => setAmount((value) => Math.max(MIN_STAKE_PER_ITEM, value))} />
                  <button type="button" className="bs-plus" onClick={() => setAmount((value) => Math.min(Math.max(MIN_STAKE_PER_ITEM, value + 1), MAX_STAKE))} disabled={!isOpen} aria-label="เพิ่มจำนวนเงิน">+</button>
                </div>
                <div className="bs-chips" aria-label="เลือกจำนวนเงิน">
                  {CHIPS.map((chip) => <button key={chip} type="button" className={`bs-chip bs-chip-${chip}`} onClick={() => setAmount(chip)} disabled={!isOpen} aria-label={`ตั้งจำนวนเงินเป็น ${chip} บาท`}>{chip >= 1000 ? "1K" : chip}</button>)}
                </div>
              </div>
            )}
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
              <button type="button" className="bs-key bs-key-danger" onClick={() => { if (confirmDiscard("ล้างทั้งหมด")) { writeDigits(""); setEntries([]); setNotice(null); } }} disabled={!isOpen || (entries.length === 0 && !digits)}>ล้างทั้งหมด</button>
            </div>
          </div>
        </section>

        <aside className="bs-card bs-review" aria-labelledby="bs-review-heading">
          <header className="bs-card-head">
            <h2 id="bs-review-heading"><span className="bs-step-badge">4</span>ยืนยันบิล</h2>
          </header>
          {/* มือถือ: แถบเดียวด้านล่าง จำนวนรายการ · ยอดรวม · สิ่งที่ยังขาด แตะแล้วเปิดรายการ */}
          <button
            ref={peekRef}
            type="button"
            className="bs-peek"
            aria-expanded={sheetOpen}
            aria-controls="bs-sheet"
            onClick={() => setSheetOpen(true)}
          >
            <span className="bs-peek-count" aria-hidden="true">{entries.length}</span>
            <span className="bs-peek-text">
              <strong>{entries.length} รายการ · {money(total)} บาท</strong>
              <small className={missing && isOpen ? "is-missing" : ""}>{peekHint}</small>
            </span>
            <span className="bs-peek-arrow" aria-hidden="true">▴</span>
          </button>
          <dl className="bs-summary">
            {entryGroups.length > 1 ? (
              entryGroups.map((section) => (
                <div key={`sum:${section.drawId}`}><dt>{section.lottery?.label ?? "งวด"} {section.draw?.dateLabel ?? ""}</dt><dd>{section.rows.length} รายการ · {money(section.total)}</dd></div>
              ))
            ) : (
              <div><dt>งวด</dt><dd>{entryGroups[0]?.lottery?.label ?? draw.lotteryLabel} {entryGroups[0]?.draw?.dateLabel ?? draw.dateLabel}</dd></div>
            )}
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
              {placing ? "กำลังสร้างบิล…" : "✓ ยืนยันบิล"}
            </button>
          </div>
          <p className="bs-review-note">เมื่อยืนยันแล้ว ระบบจะเปิดหน้าแนบหลักฐานให้ทันที</p>
        </aside>
      </div>

    </form>
  );
}
