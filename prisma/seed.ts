import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";

/** Rulebook ที่ยืนยันแล้ว: เปิดรับเฉพาะ 2 ตัวและ 3 ตัวรวม 6 ประเภท */
const PRIZE_TYPES = [
  { code: 1, name: "3 ตัวบนตรง", digits: 3, matchRule: "EXACT", payoutRate: "650.0000", isActive: true },
  { code: 2, name: "3 ตัวบนโต๊ด", digits: 3, matchRule: "PERMUTATION", payoutRate: "100.0000", isActive: true },
  { code: 3, name: "3 ตัวหน้า", digits: 3, matchRule: "EXACT", payoutRate: "450.0000", isActive: false },
  { code: 4, name: "3 ตัวท้าย", digits: 3, matchRule: "EXACT", payoutRate: "450.0000", isActive: false },
  { code: 5, name: "2 ตัวบน", digits: 2, matchRule: "EXACT", payoutRate: "75.0000", isActive: true },
  { code: 6, name: "2 ตัวล่าง", digits: 2, matchRule: "EXACT", payoutRate: "75.0000", isActive: true },
  { code: 7, name: "2 ตัวโต๊ด", digits: 2, matchRule: "PERMUTATION", payoutRate: "45.0000", isActive: false },
  // รางวัลวิ่ง: แทงหลักเดียว แต่เทียบกับผลที่ยาวกว่า จึงต้องระบุ resultDigits
  // วิ่งบนเทียบกับเลข 3 ตัวบน · วิ่งล่างเทียบกับเลข 2 ตัวล่าง
  { code: 8, name: "วิ่งบน", digits: 1, resultDigits: 3, matchRule: "CONTAINS_DIGIT", payoutRate: "3.2000", isActive: false },
  { code: 9, name: "วิ่งล่าง", digits: 1, resultDigits: 2, matchRule: "CONTAINS_DIGIT", payoutRate: "4.2000", isActive: false },
  { code: 10, name: "3 ตัวสลับ", digits: 3, matchRule: "EXACT", payoutRate: "100.0000", isActive: true },
  { code: 11, name: "2 ตัวสลับ", digits: 2, matchRule: "EXACT", payoutRate: "75.0000", isActive: true },
  { code: 12, name: "4 ตัวบน", digits: 4, matchRule: "EXACT", payoutRate: "6000.0000", isActive: false },
  { code: 13, name: "4 ตัวโต๊ด", digits: 4, matchRule: "PERMUTATION", payoutRate: "900.0000", isActive: false },
  { code: 14, name: "5 ตัวบน", digits: 5, matchRule: "EXACT", payoutRate: "30000.0000", isActive: false },
  { code: 15, name: "6 ตัวบน", digits: 6, matchRule: "EXACT", payoutRate: "100000.0000", isActive: false },
  { code: 16, name: "เลขท้าย 2 ตัว", digits: 2, matchRule: "EXACT", payoutRate: "90.0000", isActive: false },
] as const;

const AGENTS = [
  { code: "A001", name: "ตัวแทน กรุงเทพ", commissionRate: "30.0000", creditLimit: "500000.00" },
  { code: "A002", name: "ตัวแทน เชียงใหม่", commissionRate: "30.0000", creditLimit: "300000.00" },
  { code: "A003", name: "ตัวแทน หาดใหญ่", commissionRate: "30.0000", creditLimit: null },
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
  const mustChangePassword = process.env.SEED_MUST_CHANGE_PASSWORD !== "false";

  const org = await prisma.organization.upsert({
    where: { id: "seed-org" },
    update: {},
    create: {
      id: "seed-org",
      name: "องค์กรตัวอย่าง",
      timezone: "Asia/Bangkok",
    },
  });

  // Admin รับผิดชอบงานปฏิบัติการและงานตรวจสอบทั้งหมด
  const users = [
    { login: "godmode", displayName: "Godmode", role: "GODMODE" as const },
    { login: "owner", displayName: "เจ้าของกิจการ", role: "OWNER" as const },
    { login: "admin", displayName: "ผู้ดูแลระบบ", role: "ADMIN" as const },
    { login: "agent", displayName: "ตัวแทน กรุงเทพ", role: "AGENT" as const },
    { login: "agent2", displayName: "ตัวแทน เชียงใหม่", role: "AGENT" as const },
    { login: "agent3", displayName: "ตัวแทน หาดใหญ่", role: "AGENT" as const },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { organizationId_login: { organizationId: org.id, login: u.login } },
      update: {
        displayName: u.displayName,
        passwordHash,
        role: u.role,
        status: "ACTIVE",
        mustChangePassword,
      },
      create: {
        organizationId: org.id,
        login: u.login,
        displayName: u.displayName,
        passwordHash,
        role: u.role,
        mustChangePassword,
      },
    });
  }

  for (const pt of PRIZE_TYPES) {
    await prisma.prizeType.upsert({
      where: { organizationId_code: { organizationId: org.id, code: pt.code } },
      update: {
        name: pt.name,
        digits: pt.digits,
        resultDigits: "resultDigits" in pt ? pt.resultDigits : null,
        matchRule: pt.matchRule,
        payoutRate: pt.payoutRate,
        isActive: pt.isActive,
      },
      create: {
        organizationId: org.id,
        code: pt.code,
        name: pt.name,
        digits: pt.digits,
        resultDigits: "resultDigits" in pt ? pt.resultDigits : null,
        matchRule: pt.matchRule,
        payoutRate: pt.payoutRate,
        isActive: pt.isActive,
      },
    });
  }

  for (const [index, a] of AGENTS.entries()) {
    const user = await prisma.user.findUniqueOrThrow({
      where: {
        organizationId_login: {
          organizationId: org.id,
          login: index === 0 ? "agent" : `agent${index + 1}`,
        },
      },
    });

    await prisma.agent.upsert({
      where: { organizationId_code: { organizationId: org.id, code: a.code } },
      update: { commissionRate: a.commissionRate },
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
  const exampleDraw = await prisma.draw.findFirst({
    where: { organizationId: org.id, name: "งวดตัวอย่าง 1" },
    select: { id: true },
  });
  if (!exampleDraw) {
    await prisma.draw.create({
      data: {
      organizationId: org.id,
      name: "งวดตัวอย่าง 1",
      opensAt: now,
      cutoffAt: cutoff,
      status: "OPEN",
      },
    });
  }

  const counts = {
    organizations: await prisma.organization.count(),
    users: await prisma.user.count(),
    agents: await prisma.agent.count(),
    prizeTypes: await prisma.prizeType.count(),
    draws: await prisma.draw.count(),
  };
  console.log("seed เสร็จแล้ว:", counts);
  console.log("Rulebook พร้อมใช้งาน: เปิด 6 ประเภท · คอมมิชชัน Agent 30%");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
