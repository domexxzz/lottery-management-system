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
  excelHref,
  className = "",
}: {
  excelHref: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(excelHref, { credentials: "same-origin" });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "ไม่สามารถสร้างไฟล์ได้");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = responseFilename(response, "report.xlsx");
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ไม่สามารถสร้างไฟล์ได้");
    } finally {
      setBusy(false);
    }
  }

  return <div className={`report-export-buttons ${className}`.trim()}>
    <button type="button" className="is-primary" disabled={busy} onClick={download}>
      {busy ? "กำลังสร้าง Excel…" : "Export Excel"}
    </button>
    {error && <small role="alert">{error}</small>}
  </div>;
}
