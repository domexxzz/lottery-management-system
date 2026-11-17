"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LaoFlag, ThaiFlag } from "../ThaiFlag";

export type LotteryPickerDraw = {
  dateLabel: string;
  cutoffAt: string;
  cutoffLabel: string;
};

function Countdown({ cutoffAt }: { cutoffAt: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (now === null) return <strong>กำลังคำนวณเวลา…</strong>;
  const remaining = Math.max(0, Math.floor((new Date(cutoffAt).getTime() - now) / 1_000));
  if (remaining === 0) return <strong>ปิดรับแล้ว</strong>;

  const days = Math.floor(remaining / 86_400);
  const hours = Math.floor((remaining % 86_400) / 3_600);
  const minutes = Math.floor((remaining % 3_600) / 60);
  const seconds = remaining % 60;
  const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  return <strong>{days > 0 ? `${days} วัน ${clock}` : clock}</strong>;
}

function LaoCard({ lottery, title, description, draw }: { lottery: "LAO" | "LAO_SET"; title: string; description: string; draw: LotteryPickerDraw | null }) {
  return (
    <article className={`lottery-type-card is-lao${draw ? "" : " is-unavailable"}`}>
      <header>
        <span className="lottery-type-flag" aria-hidden="true"><LaoFlag className="lottery-flag-svg" /></span>
        <div><small>กลุ่มหวยลาว</small><h3>{title}</h3><p>{draw ? `งวด ${draw.dateLabel}` : description}</p></div>
        <b>{draw ? "เปิดรับ" : "ยังไม่เปิด"}</b>
      </header>
      <div className="lottery-type-time">
        <span>{draw ? "เหลือเวลาก่อนปิดรับ" : "เวลาปิดรับ"}</span>
        {draw ? <Countdown cutoffAt={draw.cutoffAt} /> : <strong>ยังไม่มีงวดเปิดรับ</strong>}
        <small>{draw ? `ปิดรับ ${draw.cutoffLabel}` : `ให้ Owner หรือ Admin สร้างงวด${title}ก่อน`}</small>
      </div>
      {draw
        ? <Link href={`/bills/new?lottery=${lottery}`}>เลือก{title} <span aria-hidden="true">→</span></Link>
        : <button type="button" disabled>ยังไม่มีงวดเปิดรับ</button>}
    </article>
  );
}

export function LotteryTypePicker({ thaiDraw, laoDraw, laoSetDraw }: { thaiDraw: LotteryPickerDraw | null; laoDraw: LotteryPickerDraw | null; laoSetDraw: LotteryPickerDraw | null }) {
  return (
    <section className="lottery-type-picker" aria-labelledby="lottery-type-heading">
      <header className="lottery-type-picker-heading">
        <span className="lottery-type-step">1</span>
        <div>
          <p>CREATE NEW BILL</p>
          <h1 id="lottery-type-heading">เลือกประเภทหวย</h1>
          <small>เลือกหวยที่ต้องการสร้างบิล ระบบจะแสดงเวลาที่เหลือก่อนปิดรับของแต่ละประเภท</small>
        </div>
      </header>

      <div className="lottery-type-section">
        <div className="lottery-type-section-title"><strong>หวยรัฐบาล</strong><span>ระบบพร้อมใช้งาน</span></div>
        <article className={`lottery-type-card is-thai${thaiDraw ? "" : " is-unavailable"}`}>
          <header>
            <span className="lottery-type-flag" aria-hidden="true"><ThaiFlag className="lottery-flag-svg" /></span>
            <div><small>ประเทศไทย</small><h3>หวยรัฐบาล</h3><p>{thaiDraw ? `งวด ${thaiDraw.dateLabel}` : "ยังไม่มีงวดที่เปิดรับ"}</p></div>
            <b>{thaiDraw ? "เปิดรับ" : "ยังไม่เปิด"}</b>
          </header>
          <div className="lottery-type-time">
            <span>{thaiDraw ? "เหลือเวลาก่อนปิดรับ" : "เวลาปิดรับ"}</span>
            {thaiDraw ? <Countdown cutoffAt={thaiDraw.cutoffAt} /> : <strong>ยังไม่มีเวลาปิดรับ</strong>}
            <small>{thaiDraw ? `ปิดรับ ${thaiDraw.cutoffLabel}` : "สร้างงวดหวยรัฐบาลก่อนจึงจะสร้างบิลได้"}</small>
          </div>
          {thaiDraw
            ? <Link href="/bills/new?lottery=THAI_GOVERNMENT">เลือกหวยรัฐบาล <span aria-hidden="true">→</span></Link>
            : <button type="button" disabled>ยังไม่มีงวดเปิดรับ</button>}
        </article>
      </div>

      <div className="lottery-type-section is-lao-group">
        <div className="lottery-type-section-title"><strong>กลุ่มหวยลาว</strong><span>ออกผลจันทร์–ศุกร์ 20:30 น.</span></div>
        <div className="lottery-type-grid">
          <LaoCard lottery="LAO" title="หวยลาว" description="แทงได้ทุกเลข" draw={laoDraw} />
          <LaoCard lottery="LAO_SET" title="หวยลาวชุด" description="แทงได้ทุกเลข แยกเพดานจากหวยลาว" draw={laoSetDraw} />
        </div>
      </div>

      <p className="lottery-type-note"><span aria-hidden="true">i</span> หวยลาวกับหวยลาวชุดใช้ผลชุดเดียวกัน แต่เพดานเลขเต็มแยกกัน</p>
    </section>
  );
}
