import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";

/**
 * ⚠️ ค่าอัตราจ่ายและนิยามรางวัลด้านล่างเป็น PLACEHOLDER สำหรับพัฒนาเท่านั้น
 *
 * ของจริงต้องรอผลการยืนยันจาก:
 *   LOT-28 (P0-1) นิยามรางวัล 16 ประเภทและรูปแบบเลขที่รับ
 *   LOT-31 (P0-2) อัตราจ่าย อัตราคอมมิชชัน และกฎการปัดเศษ
 *
 * ห้ามนำค่าชุดนี้ขึ้น staging หรือ production ก่อนสองใบนั้นปิด
 */
const PRIZE_TYPES = [
  { code: 1, name: "3 ตัวบน", digits: 3, isPermutation: false, payoutRate: "900.0000" },
  { code: 2, name: "3 ตัวโต๊ด", digits: 3, isPermutation: true, payoutRate: "150.0000" },
  { code: 3, name: "3 ตัวหน้า", digits: 3, isPermutation: false, payoutRate: "450.0000" },
  { code: 4, name: "3 ตัวท้าย", digits: 3, isPermutation: false, payoutRate: "450.0000" },
  { code: 5, name: "2 ตัวบน", digits: 2, isPermutation: false, payoutRate: "90.0000" },
  { code: 6, name: "2 ตัวล่าง", digits: 2, isPermutation: false, payoutRate: "90.0000" },
  { code: 7, name: "2 ตัวโต๊ด", digits: 2, isPermutation: true, payoutRate: "45.0000" },
  { code: 8, name: "วิ่งบน", digits: 1, isPermutation: false, payoutRate: "3.2000" },
  { code: 9, name: "วิ่งล่าง", digits: 1, isPermutation: false, payoutRate: "4.2000" },
  { code: 10, name: "3 ตัวบนกลับ", digits: 3, isPermutation: true, payoutRate: "150.0000" },
  { code: 11, name: "2 ตัวบนกลับ", digits: 2, isPermutation: true, payoutRate: "45.0000" },
  { code: 12, name: "4 ตัวบน", digits: 4, isPermutation: false, payoutRate: "6000.0000" },
  { code: 13, name: "4 ตัวโต๊ด", digits: 4, isPermutation: true, payoutRate: "900.0000" },
  { code: 14, name: "5 ตัวบน", digits: 5, isPermutation: false, payoutRate: "30000.0000" },
  { code: 15, name: "6 ตัวบน", digits: 6, isPermutation: false, payoutRate: "100000.0000" },
  { code: 16, name: "เลขท้าย 2 ตัว", digits: 2, isPermutation: false, payoutRate: "90.0000" },
] as const;

const AGENTS = [
  { code: "A001", name: "ตัวแทน กรุงเทพ", commissionRate: "25.0000", creditLimit: "500000.00" },
  { code: "A002", name: "ตัวแทน เชียงใหม่", commissionRate: "22.5000", creditLimit: "300000.00" },
  { code: "A003", name: "ตัวแทน หาดใหญ่", commissionRate: "20.0000", creditLimit: null },
] as const;

async function main() {
  // รหัสผ่านสำหรับ development อ่านจาก env เพื่อไม่ให้ค่าจริงอยู่ใน repo
  const seedPassword = process.env.SEED_PASSWORD;
  if (!seedPassword) {
    throw new Error(
      "ต้องตั้ง SEED_PASSWORD ใน .env ก่อนรัน seed (ดูค่าตัวอย่างใน .env.example)",
    );
  }

  const passwordHash = await hashPassword(seedPassword);

  const org = await prisma.organization.upsert({
    where: { id: "seed-org" },
    update: {},
    create: {
      id: "seed-org",
      name: "องค์กรตัวอย่าง",
      timezone: "Asia/Bangkok",
    },
  });

  // ผู้ใช้ครบ 4 บทบาทตาม Permission Matrix
  const users = [
    { login: "owner", displayName: "เจ้าของกิจการ", role: "OWNER" as const },
    { login: "admin", displayName: "ผู้ดูแลระบบ", role: "ADMIN" as const },
    { login: "checker", displayName: "ผู้ตรวจสอบ", role: "CHECKER" as const },
    { login: "agent1", displayName: "ตัวแทน กรุงเทพ", role: "AGENT" as const },
    { login: "agent2", displayName: "ตัวแทน เชียงใหม่", role: "AGENT" as const },
    { login: "agent3", displayName: "ตัวแทน หาดใหญ่", role: "AGENT" as const },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { organizationId_login: { organizationId: org.id, login: u.login } },
      update: {},
      create: {
        organizationId: org.id,
        login: u.login,
        displayName: u.displayName,
        passwordHash,
        role: u.role,
        mustChangePassword: true,
      },
    });
  }

  for (const pt of PRIZE_TYPES) {
    await prisma.prizeType.upsert({
      where: { organizationId_code: { organizationId: org.id, code: pt.code } },
      update: {
        name: pt.name,
        digits: pt.digits,
        isPermutation: pt.isPermutation,
        payoutRate: pt.payoutRate,
      },
      create: {
        organizationId: org.id,
        code: pt.code,
        name: pt.name,
        digits: pt.digits,
        isPermutation: pt.isPermutation,
        payoutRate: pt.payoutRate,
      },
    });
  }

  for (const [index, a] of AGENTS.entries()) {
    const user = await prisma.user.findUniqueOrThrow({
      where: {
        organizationId_login: { organizationId: org.id, login: `agent${index + 1}` },
      },
    });

    await prisma.agent.upsert({
      where: { organizationId_code: { organizationId: org.id, code: a.code } },
      update: {},
      create: {
        organizationId: org.id,
        code: a.code,
        name: a.name,
        commissionRate: a.commissionRate,
        creditLimit: a.creditLimit,
        userId: user.id,
      },
    });
  }

  // รอบตัวอย่างที่ยังเปิดรับ ปิดรับอีก 7 วันข้างหน้า
  const now = new Date();
  const cutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  await prisma.draw.upsert({
    where: { organizationId_name: { organizationId: org.id, name: "งวดตัวอย่าง 1" } },
    update: {},
    create: {
      organizationId: org.id,
      name: "งวดตัวอย่าง 1",
      opensAt: now,
      cutoffAt: cutoff,
      status: "OPEN",
    },
  });

  const counts = {
    organizations: await prisma.organization.count(),
    users: await prisma.user.count(),
    agents: await prisma.agent.count(),
    prizeTypes: await prisma.prizeType.count(),
    draws: await prisma.draw.count(),
  };
  console.log("seed เสร็จแล้ว:", counts);
  console.log("⚠️ อัตราจ่ายในชุดนี้เป็น placeholder รอผลจาก LOT-28 และ LOT-31");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
