import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // ให้ build ออกมาเป็น standalone server สำหรับใส่ container (ดู Dockerfile)
  output: "standalone",
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
