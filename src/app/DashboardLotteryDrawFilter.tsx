"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { AppDropdown } from "./AppDropdown";
import { LotteryFlag } from "./bills/ThaiFlag";
import type { DashboardLotteryCategory } from "@/lib/dashboard/lottery-draw-filter";

export type DashboardDrawOption = {
  id: string;
  label: string;
  lotteryType: string;
  category: Exclude<DashboardLotteryCategory, "ALL">;
  status?: string;
};

const ROWS: { category: DashboardLotteryCategory; label: string; flag?: string }[] = [
  { category: "ALL", label: "ทุกประเภท" },
  { category: "THAI_GOVERNMENT", label: "หวยรัฐบาล", flag: "THAI_GOVERNMENT" },
  { category: "LAO_COMBINED", label: "หวยลาวและหวยลาวชุด", flag: "LAO" },
];

const statusBadge = (status?: string) => status === "OPEN" ? "เปิดรับ" : status === "LOCKED" || status === "RESULT_PENDING" ? "รอผล" : undefined;

/** ตัวเลือกประเภท + งวดมาตรฐานเดียวกันสำหรับภาพรวมหลักและภาพรวม Agent */
export function DashboardLotteryDrawFilter({
  draws,
  category,
  selectedDrawId,
  className = "",
  clearDateRangeOnDraw = false,
}: {
  draws: DashboardDrawOption[];
  category: DashboardLotteryCategory;
  selectedDrawId?: string;
  className?: string;
  clearDateRangeOnDraw?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function navigate(nextCategory: DashboardLotteryCategory, drawId?: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.delete("draw");
    if (nextCategory === "ALL") params.delete("lottery");
    else params.set("lottery", nextCategory);
    if (drawId) params.set("drawId", drawId);
    else params.delete("drawId");
    if (drawId && clearDateRangeOnDraw) {
      params.delete("from");
      params.delete("to");
      params.delete("dateFrom");
      params.delete("dateTo");
    }
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  return (
    <section className={`dashboard-lottery-filter ${className} ${pending ? "is-loading" : ""}`} aria-label="เลือกประเภทหวยและงวด" aria-busy={pending}>
      {ROWS.map((row) => {
        const choices = row.category === "ALL" ? draws : draws.filter((draw) => draw.category === row.category);
        const active = category === row.category;
        const value = active && selectedDrawId && choices.some((draw) => draw.id === selectedDrawId) ? selectedDrawId : "all";
        return (
          <div className="dashboard-lottery-row" key={row.category}>
            <button type="button" className="dashboard-lottery-type" aria-pressed={active} onClick={() => navigate(row.category)}>
              {row.flag && <LotteryFlag lotteryType={row.flag} />}
              <span>{row.label}</span>
            </button>
            <AppDropdown
              className="dashboard-lottery-draw"
              ariaLabel={`เลือกงวด ${row.label}`}
              value={value}
              searchable={choices.length > 8}
              searchPlaceholder="ค้นหางวด"
              onValueChange={(next) => {
                if (!next) return;
                if (next === "all") return navigate(row.category);
                const selected = choices.find((draw) => draw.id === next);
                navigate(row.category === "ALL" ? selected?.category ?? "ALL" : row.category, next);
              }}
              options={[
                { value: "all", label: row.category === "ALL" ? "รวมทุกงวด ทุกประเภท" : `รวมทุกงวด ${row.label}` },
                ...choices.map((draw) => ({ value: draw.id, label: draw.label, lotteryType: draw.lotteryType, badge: statusBadge(draw.status) })),
              ]}
            />
          </div>
        );
      })}
      {pending && <span className="dashboard-lottery-loading" role="status">กำลังอัปเดตข้อมูล…</span>}
    </section>
  );
}

