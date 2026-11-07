"use client";

export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <section className="route-state" aria-labelledby="route-error-title">
      <div className="card">
        <h1 id="route-error-title">เปิดหน้านี้ไม่สำเร็จ</h1>
        <p role="alert">เกิดข้อผิดพลาดระหว่างโหลดข้อมูล กรุณาลองอีกครั้ง</p>
        <button type="button" onClick={retry}>ลองอีกครั้ง</button>
      </div>
    </section>
  );
}
