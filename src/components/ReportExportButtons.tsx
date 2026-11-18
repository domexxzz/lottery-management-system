"use client";

import { useState } from "react";

function responseFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* ใช้ fallback */ }
  }
  return fallback;
}

export function ReportExportButtons({
  csvHref,
  excelHref,
  className = "",
}: {
  csvHref: string;
  excelHref: string;
  className?: string;
}) {
  const [busy, setBusy] = useState<"csv" | "xlsx" | null>(null);
  const [error, setError] = useState("");

  async function download(format: "csv" | "xlsx") {
    setBusy(format);
    setError("");
    try {
      const response = await fetch(format === "xlsx" ? excelHref : csvHref, { credentials: "same-origin" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "ไม่สามารถสร้างไฟล์ได้");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = responseFilename(response, `report.${format}`);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ไม่สามารถสร้างไฟล์ได้");
    } finally {
      setBusy(null);
    }
  }

  return <div className={`report-export-buttons ${className}`.trim()}>
    <button type="button" className="is-primary" disabled={busy !== null} onClick={() => download("xlsx")}>
      {busy === "xlsx" ? "กำลังสร้าง Excel…" : "Export Excel"}
    </button>
    <button type="button" disabled={busy !== null} onClick={() => download("csv")}>
      {busy === "csv" ? "กำลังสร้าง CSV…" : "Export CSV"}
    </button>
    {error && <small role="alert">{error}</small>}
  </div>;
}
