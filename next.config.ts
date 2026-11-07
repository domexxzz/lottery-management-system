import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // ให้ build ออกมาเป็น standalone server สำหรับใส่ container (ดู Dockerfile)
  output: "standalone",

  /*
   * build ด้วย webpack ไม่ใช่ Turbopack — ดู --webpack ใน package.json
   *
   * Turbopack ใช้หน่วยความจำราว 2GB ตอน build ซึ่งเกินที่เครื่อง build
   * ของผู้ให้บริการให้มา มันจะถูก OOM killer ฆ่าระหว่าง static generation
   * แล้วโผล่เป็น TypeError: Cannot read properties of null (reading 'useContext')
   * ที่หน้า /_global-error ซึ่งอ่านแล้วไม่มีทางเดาว่าเป็นเรื่องหน่วยความจำ
   *
   * วัดจริงในคอนเทนเนอร์จำกัดหน่วยความจำ: Turbopack ตายที่ 1GB ผ่านที่ 2GB
   * ส่วน webpack ผ่านตั้งแต่ 768MB
   */

  // จำกัดจำนวน worker ตอน build
  // ค่าเริ่มต้นคือจำนวน CPU ซึ่งบนเครื่องพัฒนาทำให้เปิด worker พร้อมกัน 15 ตัว
  // แต่ละตัวโหลด Prisma client ของตัวเอง จนหน่วยความจำไม่พอและ worker ตาย
  // ด้วย FATAL ERROR: Zone Allocation failed
  experimental: {
    cpus: 4,
  },
  async headers() {
    // Security headers ขั้นต้น ส่วนที่เหลืออยู่ใน LOT-16 (P5-3)
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
