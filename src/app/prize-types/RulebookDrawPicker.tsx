"use client";

import { useRouter } from "next/navigation";
import { AppDropdown } from "../AppDropdown";

export function RulebookDrawPicker({
  value,
  draws,
}: {
  value: string;
  draws: { id: string; name: string; dateLabel: string; cutoffLabel: string }[];
}) {
  const router = useRouter();

  return (
    <div className="rulebook-draw-picker">
      <div>
        <strong>เลือกงวดที่ต้องการกำหนดเลขอั้น</strong>
        <small>ค้นหาได้ทั้งชื่องวดหรือวันที่</small>
      </div>
      <AppDropdown
        searchable
        value={value}
        ariaLabel="เลือกงวดที่ต้องการกำหนดเลขอั้น"
        searchPlaceholder="ค้นหาชื่องวดหรือวันที่ เช่น 16/11/2569"
        emptyMessage="ไม่พบงวดที่ตรงกับคำค้นหา"
        options={draws.map((draw) => ({
          value: draw.id,
          label: draw.name,
          description: `${draw.dateLabel} · ปิดรับ ${draw.cutoffLabel}`,
          badge: "เปิดรับ",
        }))}
        onValueChange={(drawId) => {
          router.replace(`/prize-types?drawId=${encodeURIComponent(drawId)}#number-restrictions`);
        }}
      />
    </div>
  );
}
