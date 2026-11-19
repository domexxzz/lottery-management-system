"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AppDropdown } from "../AppDropdown";
import { LotteryFlag } from "../bills/ThaiFlag";

export type PickerDraw = {
  id: string;
  lotteryType: string;
  category: "THAI_GOVERNMENT" | "LAO_COMBINED";
  fullLabel: string;
  open: boolean;
  settled: boolean;
};

const STATUS_BADGE = (draw: PickerDraw) => draw.open ? "กำลังขาย" : draw.settled ? "" : "รอผล";
const LOTTERIES = ["THAI_GOVERNMENT", "LAO", "LAO_SET"];
const categoryLotteries = (category: "ALL" | PickerDraw["category"]) =>
  category === "ALL" ? LOTTERIES : category === "THAI_GOVERNMENT" ? ["THAI_GOVERNMENT"] : ["LAO", "LAO_SET"];

/** ตัวกรองรายงาน 3 แถว แต่ละประเภทมีช่องเลือกงวดของตัวเอง */
export function ReportViewPicker({ lotteries, selectedId, draws }: {
  lotteries: string[];
  selectedId: string;
  draws: PickerDraw[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const go = (href: string) => startTransition(() => router.push(href, { scroll: false }));
  const activeCategory: "ALL" | PickerDraw["category"] = lotteries.length === 3
    ? "ALL"
    : lotteries.includes("THAI_GOVERNMENT") ? "THAI_GOVERNMENT" : "LAO_COMBINED";

  const hrefFor = (category: "ALL" | PickerDraw["category"], draw = "all") => {
    const params = new URLSearchParams();
    const selectedLotteries = categoryLotteries(category);
    if (selectedLotteries.length < 3) params.set("lottery", selectedLotteries.join(","));
    params.set("draw", draw);
    return `/reports?${params}`;
  };

  const rows: { category: "ALL" | PickerDraw["category"]; label: string; flag?: string }[] = [
    { category: "ALL", label: "ทุกประเภท" },
    { category: "THAI_GOVERNMENT", label: "หวยรัฐบาล", flag: "THAI_GOVERNMENT" },
    { category: "LAO_COMBINED", label: "หวยลาวและหวยลาวชุด", flag: "LAO" },
  ];

  return (
    <section className={`or-view or-view-rows ${pending ? "is-loading" : ""}`} aria-label="เลือกประเภทหวยและงวด" aria-busy={pending}>
      {rows.map((row) => {
        const choices = row.category === "ALL" ? draws : draws.filter((draw) => draw.category === row.category);
        const active = activeCategory === row.category;
        const value = active && choices.some((draw) => draw.id === selectedId) ? selectedId : "all";
        return (
          <div className="or-view-row" key={row.category}>
            <button type="button" className="or-type-button" aria-pressed={active} onClick={() => go(hrefFor(row.category))}>
              {row.flag && <LotteryFlag lotteryType={row.flag} />}
              <span>{row.label}</span>
            </button>
            <AppDropdown
              className="or-draw-select"
              ariaLabel={`เลือกงวด ${row.label}`}
              value={value}
              searchable={choices.length > 8}
              searchPlaceholder="ค้นหาวันที่งวด"
              onValueChange={(next) => {
                if (!next) return;
                const selected = choices.find((draw) => draw.id === next);
                const category = row.category === "ALL" && selected ? selected.category : row.category;
                go(hrefFor(category, next));
              }}
              options={[
                { value: "all", label: row.category === "ALL" ? "รวมทุกงวด ทุกประเภท" : `รวมทุกงวด ${row.label}` },
                ...choices.map((draw) => ({
                  value: draw.id,
                  label: draw.fullLabel,
                  lotteryType: draw.lotteryType,
                  badge: STATUS_BADGE(draw) || undefined,
                })),
              ]}
            />
          </div>
        );
      })}
      {pending && <span className="or-view-loading" role="status">กำลังโหลด…</span>}
    </section>
  );
}
