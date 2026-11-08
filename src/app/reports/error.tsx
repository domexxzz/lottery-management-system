"use client";

import "./reports.css";

export default function ReportsError({ retry }: { error: Error; retry: () => void }) {
  return <main className="workspace-page reports-page reports-page--blue"><section className="card workspace-card report-workspace report-workspace--blue report-route-error" role="alert"><span aria-hidden="true">!</span><h1>โหลดรายงานไม่สำเร็จ</h1><p>ลองโหลดข้อมูลอีกครั้ง หากยังไม่สำเร็จโปรดกลับมาใหม่ภายหลัง</p><button type="button" onClick={retry}>ลองอีกครั้ง</button></section></main>;
}
