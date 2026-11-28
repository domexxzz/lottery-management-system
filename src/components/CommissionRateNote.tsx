import "./commission-rate-note.css";

/**
 * ป้ายบอกอัตราค่าคอมที่ใช้จริง และบอกว่างวดไหนเข้าโปรโมชั่น
 *
 * ใช้ตัวเดียวกันทุกหน้าที่แสดงค่าคอม เพราะถ้าแต่ละหน้าเขียนเอง คำอธิบายจะเริ่มต่างกัน
 * แล้วคนอ่านจะไม่รู้ว่าหน้าไหนพูดความจริง
 *
 * แสดงอัตราที่ใช้จริงเป็นรายการ ไม่ใช่ค่าเฉลี่ยถ่วงน้ำหนัก
 * ตั้งโปรโมชั่นไว้ 32% ก็ต้องเห็น 32% ไม่ใช่ 31.97% ที่กระทบยอดด้วยมือไม่ได้
 * และไม่ตรงกับตัวเลขที่ตกลงกับ Agent ไว้
 */

const RATE = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });

export type CommissionRateNoteProps = {
  /** อัตราปกติที่ถูกใช้จริงในช่วงที่ดู ว่างได้ถ้าทุกงวดเข้าโปรโมชั่น */
  baseRates?: number[];
  /** อัตราโปรโมชั่นที่ถูกใช้จริง ว่าง = ไม่มีงวดไหนเข้าเกณฑ์ */
  promotionRates?: number[];
  /** จำนวนงวดที่เข้าเกณฑ์โปรโมชั่น */
  promotionDraws?: number;
  /** อัตราที่ตั้งไว้ในโปรไฟล์ ใช้เมื่อยังไม่มีงวดที่คำนวณแล้ว */
  fallbackRate: number;
  /** true = ตัวเลขเป็นประมาณการเพราะยังไม่ปิดบัญชี */
  estimated?: boolean;
};

export function formatRate(value: number): string {
  return `${RATE.format(value)}%`;
}

export function CommissionRateNote({
  baseRates = [],
  promotionRates = [],
  promotionDraws = 0,
  fallbackRate,
  estimated = false,
}: CommissionRateNoteProps) {
  /*
   * ตั้งค่าเริ่มต้นเป็นรายการว่างไว้ด้วย
   *
   * ป้ายนี้ถูกเรียกจากหลายหน้า บางหน้าส่งข้อมูลข้ามฝั่ง server/client
   * ถ้าหน้าไหนลืมส่งมา ต้องขึ้นเป็นเรตปกติ ไม่ใช่ทำให้ทั้งหน้าพัง
   */
  const settled = baseRates.length > 0 || promotionRates.length > 0;
  if (!settled) {
    return <small className="commission-rate-note">
      ({formatRate(fallbackRate)} {estimated ? "ประมาณการ" : "ตามเรตปกติ"})
    </small>;
  }

  return <small className="commission-rate-note">
    ({baseRates.map(formatRate).join(" · ") || "—"}
    {estimated && " ประมาณการ"})
    {promotionRates.length > 0 && <b className="commission-rate-promotion">
      โปรฯ {promotionRates.map(formatRate).join(" · ")}
      {promotionDraws > 0 && ` · ${promotionDraws} งวด`}
    </b>}
  </small>;
}

/** ป้ายสั้นสำหรับแถวที่มีที่ว่างน้อย บอกแค่ว่าเข้าโปรโมชั่นกี่งวด */
export function PromotionHitBadge({ promotionDraws, promotionRates }: { promotionDraws: number; promotionRates?: number[] }) {
  if (promotionDraws <= 0) return null;
  const rate = promotionRates?.length ? ` ${promotionRates.map(formatRate).join(" · ")}` : "";
  return <b className="commission-rate-promotion">✓ โปรฯ{rate} · {promotionDraws} งวด</b>;
}
