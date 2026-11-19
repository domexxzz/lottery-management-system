"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AppDropdown } from "../AppDropdown";
import { LotteryFlag } from "../bills/ThaiFlag";

export type PickerDraw = {
  id: string;
  lotteryType: string;
  /** ชื่อเต็ม เช่น หวยลาวชุด · 18 พ.ย. 69 */
  fullLabel: string;
  open: boolean;
  settled: boolean;
};

const LOTTERIES = [
  { value: "THAI_GOVERNMENT", label: "หวยรัฐบาล" },
  { value: "LAO", label: "หวยลาว" },
  { value: "LAO_SET", label: "หวยลาวชุด" },
] as const;

const STATUS_BADGE = (draw: PickerDraw) => (draw.open ? "กำลังขาย" : draw.settled ? "" : "รอผล");

/**
 * ตัวเลือกของหน้ารายงาน 2 แถว: ① ประเภทหวย ② งวด
 * งวดเลือกจากเมนูเดียว (ชื่อเต็ม: ประเภทหวย · วันที่ + สถานะ) และปุ่ม ‹ › ไปงวดก่อน/ถัดไป
 * แทนชิปวันที่เรียงยาวที่ดูซ้ำกันจนแยกไม่ออกว่าเป็นหวยลาวหรือลาวชุด
 */
export function ReportViewPicker({ lotteries, selectedId, draws }: {
  /** ประเภทหวยที่เลือก (ครบทุกประเภท = ทุกประเภท) */
  lotteries: string[];
  /** "all" = รวมทุกงวด */
  selectedId: string;
  /** ใหม่ → เก่า */
  draws: PickerDraw[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const allMode = selectedId === "all";

  const allSelected = lotteries.length === LOTTERIES.length;

  function hrefFor(change: { lotteries?: string[]; draw?: string }) {
    const params = new URLSearchParams();
    const nextLotteries = change.lotteries ?? lotteries;
    if (nextLotteries.length < LOTTERIES.length) params.set("lottery", nextLotteries.join(","));
    // เปลี่ยนประเภทหวย: อยู่โหมดทุกงวดก็ยังเป็นทุกงวด
    // งวดที่ดูอยู่ยังอยู่ในประเภทที่เลือก = ดูงวดเดิมต่อ ไม่งั้นให้ระบบเลือกงวดเริ่มต้นของประเภทนั้น
    const keepDraw = allMode || nextLotteries.includes(draws.find((draw) => draw.id === selectedId)?.lotteryType ?? "");
    const nextDraw = change.draw ?? (change.lotteries !== undefined && !keepDraw ? "" : selectedId);
    if (nextDraw) params.set("draw", nextDraw);
    return `/reports${params.size ? `?${params}` : ""}`;
  }

  /**
   * เลือกได้หลายประเภท แบบเดียวกับสรุปบัญชี
   * - จาก "ทุกประเภท" แตะประเภทไหน = ดูเฉพาะประเภทนั้น
   * - จากนั้นแตะเพิ่ม/เอาออกทีละประเภท เอาออกจนไม่เหลือ หรือเลือกครบ = กลับไปทุกประเภท
   */
  function toggleLottery(value: string) {
    if (allSelected) return go(hrefFor({ lotteries: [value] }));
    const next = lotteries.includes(value)
      ? lotteries.filter((lottery) => lottery !== value)
      : LOTTERIES.map((item) => item.value as string).filter((lottery) => lotteries.includes(lottery) || lottery === value);
    go(hrefFor({ lotteries: next.length === 0 ? LOTTERIES.map((item) => item.value) : next }));
  }
  const go = (href: string) => startTransition(() => router.push(href, { scroll: false }));

  const index = draws.findIndex((draw) => draw.id === selectedId);
  const older = index >= 0 ? draws[index + 1] : undefined;
  const newer = index > 0 ? draws[index - 1] : undefined;
  const selected = index >= 0 ? draws[index] : undefined;
  const badge = selected ? STATUS_BADGE(selected) : "";

  return (
    <section className={`or-view ${pending ? "is-loading" : ""}`} aria-label="เลือกสิ่งที่ต้องการดู" aria-busy={pending}>
      <div className="or-view-line">
        <span className="or-view-label">ประเภทหวย</span>
        <nav className="or-view-chips" aria-label="ประเภทหวย (เลือกได้หลายประเภท)">
          <button type="button" aria-pressed={allSelected} onClick={() => go(hrefFor({ lotteries: LOTTERIES.map((item) => item.value) }))}>ทุกประเภท</button>
          {LOTTERIES.map((item) => {
            const on = !allSelected && lotteries.includes(item.value);
            return (
              <button key={item.value} type="button" aria-pressed={on} onClick={() => toggleLottery(item.value)}>
                <span className="or-check" aria-hidden="true">{on ? "✓" : ""}</span>
                <LotteryFlag lotteryType={item.value} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
      <div className="or-view-line">
        <span className="or-view-label">งวด</span>
        <div className="or-draw-nav">
          <button type="button" className="or-step" aria-label={older ? `งวดก่อนหน้า: ${older.fullLabel}` : "งวดก่อนหน้า"} title="งวดก่อนหน้า" disabled={!older} onClick={() => older && go(hrefFor({ draw: older.id }))}>‹</button>
          <AppDropdown
            className="or-draw-select"
            ariaLabel="เลือกงวด"
            value={selectedId}
            searchable={draws.length > 8}
            searchPlaceholder="ค้นหางวด เช่น ลาวชุด หรือ 19 พ.ย."
            onValueChange={(value) => { if (value && value !== selectedId) go(hrefFor({ draw: value })); }}
            options={[
              { value: "all", label: "รวมทุกงวด", description: "ยอดรวมทุกงวดของประเภทที่เลือก" },
              ...draws.map((draw) => ({ value: draw.id, label: draw.fullLabel, lotteryType: draw.lotteryType, badge: STATUS_BADGE(draw) || undefined })),
            ]}
          />
          <button type="button" className="or-step" aria-label={newer ? `งวดถัดไป: ${newer.fullLabel}` : "งวดถัดไป"} title="งวดถัดไป" disabled={!newer} onClick={() => newer && go(hrefFor({ draw: newer.id }))}>›</button>
        </div>
        {badge && <em className={`or-chip-badge ${selected!.open ? "is-open" : "is-pending"}`}>{badge}</em>}
        {pending && <span className="or-view-loading" role="status">กำลังโหลด…</span>}
      </div>
    </section>
  );
}
