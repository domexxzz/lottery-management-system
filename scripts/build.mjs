import { spawnSync } from "node:child_process";

/**
 * ตัวห่อคำสั่ง build
 *
 * มีไว้เพื่อบังคับสองอย่างให้ติดไปกับ repo ไม่ใช่ไปตั้งที่ผู้ให้บริการ
 *
 * 1. NODE_ENV=production
 *
 *    ถ้าไม่ใช่ production ตอน build Next จะหยิบ React ตัว development มาใช้
 *    แล้ว prerender จะล้มด้วย
 *      TypeError: Cannot read properties of undefined (reading 'length')
 *    ซึ่งไม่บอกสักคำว่าเกี่ยวกับ NODE_ENV และหน้าที่ล้มย้ายไปเรื่อย ๆ
 *    จนหลงคิดว่าเป็นปัญหาหน่วยความจำ
 *
 *    จุดสังเกตคือ warning เรื่อง key prop ที่พ่นรัว ๆ บน element ภายใน
 *    ของ Next เอง React ตัด warning พวกนี้ทิ้งทั้งหมดใน production build
 *    เห็นเมื่อไรแปลว่ากำลังรัน React ตัว development อยู่
 *
 * 2. --webpack
 *
 *    Turbopack ใช้หน่วยความจำราว 2GB ตอน build ซึ่งเกินที่เครื่อง build
 *    ขนาดเล็กให้มา แล้วถูก OOM killer ฆ่า ส่วน webpack ผ่านตั้งแต่ 768MB
 *
 * เขียนเป็นสคริปต์แทนที่จะใส่ NODE_ENV=production หน้าคำสั่งใน package.json
 * เพราะรูปแบบนั้นใช้ได้เฉพาะ sh บน Windows จะพังทันที และเขียนไว้ที่นี่
 * แทนที่จะไปตั้งใน render.yaml เพราะถ้าผู้ให้บริการยังไม่ได้ sync ไฟล์นั้น
 * ค่าจะไม่มีผล แต่โค้ดใน repo มีผลเสมอ
 */

process.env.NODE_ENV = "production";

const result = spawnSync("next", ["build", "--webpack"], {
  stdio: "inherit",
  env: process.env,
  // Windows ต้องผ่าน shell ถึงจะเจอ next.cmd ใน node_modules/.bin
  shell: true,
});

if (result.error) {
  console.error("เรียก next build ไม่สำเร็จ:", result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
