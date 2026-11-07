"use client";

import { useState } from "react";
import { AppDropdown } from "../../AppDropdown";

type OfficialResult = {
  drawDate: string;
  firstPrize: string;
  last2: string;
  front3: string[];
  back3: string[];
};

type ImportData = {
  official: OfficialResult;
  suggestions: Record<string, { values: string[]; source: string }>;
  source: string;
};

type DrawDateOption = { value: string; label: string };

export function GloResultImporter({ drawId, dateOptions }: { drawId: string; dateOptions: DrawDateOption[] }) {
  const [data, setData] = useState<ImportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filledCount, setFilledCount] = useState(0);
  const [drawDate, setDrawDate] = useState(dateOptions[0]?.value ?? "");

  async function importResults() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/draws/${encodeURIComponent(drawId)}/glo-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drawDate }),
      });
      const payload = await response.json() as { data?: ImportData; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "ไม่สามารถดึงผลจาก GLO ได้");

      let filled = 0;
      document.querySelectorAll<HTMLInputElement>("input[data-glo-prize-code]").forEach((input) => {
        const code = input.dataset.gloPrizeCode;
        const suggestion = code ? payload.data!.suggestions[code] : undefined;
        if (!suggestion) return;
        const valueIndex = Number(input.dataset.gloValueIndex ?? "0");
        const value = suggestion.values[valueIndex];
        if (value === undefined) return;
        input.value = value;
        input.dataset.gloImported = "true";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        filled += 1;
      });
      setData(payload.data);
      setFilledCount(filled);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ไม่สามารถดึงผลจาก GLO ได้");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="glo-importer" aria-label="ดึงผลรางวัลจากสำนักงานสลากกินแบ่งรัฐบาล">
      <div className="glo-importer-heading">
        <div><strong>ดึงผลจากสำนักงานสลากฯ</strong><small>ระบบจะเติมแบบฟอร์มเท่านั้น ยังไม่บันทึกจนกว่า Admin จะตรวจและกดบันทึกผลทั้งหมด</small></div>
        <label><span>งวดผลสลาก</span><AppDropdown value={drawDate} onValueChange={setDrawDate} required searchable={dateOptions.length > 8} searchPlaceholder="ค้นหางวด" placeholder="เลือกงวดวันที่ 1 หรือ 16" options={dateOptions.map((option) => ({ ...option, description: "ผลสลากกินแบ่งรัฐบาล" }))} /></label>
        <button type="button" onClick={importResults} disabled={loading || !drawDate}>{loading ? "กำลังดึงผล..." : "ดึงผลจาก GLO"}</button>
      </div>
      {error && <p className="glo-import-error" role="alert">{error}</p>}
      {data && (
        <div className="glo-import-preview" role="status">
          <div><span>งวดวันที่</span><strong>{data.official.drawDate}</strong></div>
          <div><span>รางวัลที่ 1</span><strong>{data.official.firstPrize}</strong></div>
          <div><span>เลขท้าย 2 ตัว</span><strong>{data.official.last2}</strong></div>
          <div><span>เลขหน้า 3 ตัว</span><strong>{data.official.front3.join(" · ")}</strong></div>
          <div><span>เลขท้าย 3 ตัว</span><strong>{data.official.back3.join(" · ")}</strong></div>
          <p><b>เติมแล้ว {filledCount} ช่อง</b><span>ยังไม่บันทึก · กรุณาตรวจทุกช่องก่อนกดบันทึกผลทั้งหมด</span></p>
          <p>
            <b>เติมผล GLO ครบแล้ว</b>
            <span>
              3 ตัวหน้าและ 3 ตัวท้ายถูกเติมรางวัลละ 2 เลขตามผลทางการ
              ({data.official.front3.join(" · ")} และ {data.official.back3.join(" · ")})
            </span>
          </p>
        </div>
      )}
    </section>
  );
}
