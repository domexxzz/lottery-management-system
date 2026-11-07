"use client";

/**
 * ด่านสุดท้ายเมื่อ layout ราก หรือ error boundary อื่นพังเสียเอง
 *
 * ไฟล์นี้แทนที่หน้า /_global-error ที่ Next ปั้นขึ้นเองเมื่อโปรเจกต์ไม่ได้เขียนไว้
 * ซึ่งเป็นหน้าที่ prerender ล้มตอน build บน Render ด้วย
 * TypeError: Cannot read properties of null (reading 'useContext')
 *
 * ต้อง render <html> และ <body> เอง เพราะตอนที่ถูกเรียกใช้ layout ราก
 * ไม่ถูก render แล้ว และต้องเป็น client component ตามข้อกำหนดของ Next
 *
 * สไตล์เขียน inline ทั้งหมด ไม่พึ่ง globals.css เพราะถ้ามาถึงจุดนี้
 * สมมติว่า CSS โหลดสำเร็จไม่ได้อีกแล้ว
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="th">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#0f2537",
          color: "#e8f1f5",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <main
          style={{
            width: "min(32rem, 100%)",
            padding: "1.75rem",
            borderRadius: "14px",
            background: "#14314a",
            border: "1px solid #24506f",
          }}
        >
          <h1 style={{ margin: "0 0 .5rem", fontSize: "1.15rem" }}>ระบบขัดข้อง</h1>
          <p style={{ margin: "0 0 1rem", lineHeight: 1.6, color: "#b9d2e0", fontSize: ".85rem" }}>
            เกิดข้อผิดพลาดที่ระบบจัดการเองไม่ได้ ข้อมูลที่บันทึกไปแล้วไม่ได้รับผลกระทบ
            เพราะทุกการเปลี่ยนแปลงถูกเขียนเป็นทรานแซกชันเดียวจบ
          </p>

          {/*
            * digest คือรหัสที่ผูกกับ log ฝั่งเซิร์ฟเวอร์
            * ผู้ใช้แจ้งรหัสนี้แล้วผู้ดูแลค้นเจอเหตุการณ์จริงได้ทันที
            * ไม่ต้องเดาว่าเกิดอะไรขึ้นตอนไหน
            */}
          {error.digest && (
            <p
              style={{
                margin: "0 0 1.25rem",
                padding: ".55rem .7rem",
                borderRadius: "8px",
                background: "#0f2537",
                color: "#8fb6cc",
                fontSize: ".75rem",
                fontFamily: "ui-monospace, monospace",
                overflowWrap: "anywhere",
              }}
            >
              รหัสอ้างอิงสำหรับแจ้งผู้ดูแล: {error.digest}
            </p>
          )}

          <div style={{ display: "flex", gap: ".6rem", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: ".6rem 1rem",
                border: 0,
                borderRadius: "9px",
                background: "#128b98",
                color: "#fff",
                fontSize: ".8rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ลองใหม่
            </button>
            {/*
              * โหลดหน้าใหม่ทั้งหน้า ไม่ใช้ next/link
              *
              * มาถึงจุดนี้แปลว่า error boundary ชั้นบนพังหมดแล้ว router ของ Next
              * อาจเป็นตัวที่พังเอง การนำทางแบบ client side จึงไม่น่าเชื่อถือ
              * ส่วนการโหลดใหม่ทั้งหน้าเริ่มทุกอย่างจากศูนย์ซึ่งเป็นสิ่งที่ต้องการ
              */}
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              style={{
                padding: ".6rem 1rem",
                borderRadius: "9px",
                border: "1px solid #24506f",
                background: "transparent",
                color: "#b9d2e0",
                fontSize: ".8rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              กลับหน้าแรก
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
