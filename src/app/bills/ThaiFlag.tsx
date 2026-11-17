/** ธงไทยขนาดเล็ก ใช้ SVG แทนอีโมจิ เพราะ Windows แสดงอีโมจิธงเป็นตัวอักษร TH */
export function ThaiFlag({ className = "thai-flag" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 9 6" width="22" height="15" aria-hidden="true" focusable="false">
      <rect width="9" height="6" fill="#a51931" />
      <rect y="1" width="9" height="4" fill="#f4f5f8" />
      <rect y="2" width="9" height="2" fill="#2d2a4a" />
    </svg>
  );
}

/** ธงลาวขนาดเล็ก (SVG) */
export function LaoFlag({ className = "thai-flag" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 9 6" width="22" height="15" aria-hidden="true" focusable="false">
      <rect width="9" height="6" fill="#ce1126" />
      <rect y="1.5" width="9" height="3" fill="#002868" />
      <circle cx="4.5" cy="3" r="1.2" fill="#ffffff" />
    </svg>
  );
}

/** ธงตามประเภทหวย: หวยลาว/หวยลาวชุด = ธงลาว นอกนั้นธงไทย */
export function LotteryFlag({ lotteryType, className }: { lotteryType: string; className?: string }) {
  return lotteryType === "LAO" || lotteryType === "LAO_SET" ? <LaoFlag className={className} /> : <ThaiFlag className={className} />;
}
