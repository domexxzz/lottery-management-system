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
