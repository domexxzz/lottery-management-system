import "dotenv/config";
import { writeAudit } from "../src/lib/audit";
import { prisma } from "../src/lib/db";
import { can } from "../src/lib/auth/permissions";

/**
 * ผูกบัญชี Telegram เข้ากับผู้ใช้ในระบบ
 *
 *   npm run notify:link -- --login owner --telegram 8627938804
 *   npm run notify:link -- --list
 *   npm run notify:link -- --login owner --unlink
 *
 * ทำผ่านบรรทัดคำสั่งโดยเจตนา ไม่ทำผ่านการพิมพ์ในแชท
 * เพราะการผูกบัญชีในแชทที่ปลอดภัยต้องใช้รหัสยืนยัน ซึ่งซับซ้อนเกินความจำเป็น
 * ตอนนี้ และวิธีที่ง่ายกว่านั้นมักลงเอยด้วยการให้พิมพ์รหัสผ่านลงแชท ซึ่งห้ามเด็ดขาด
 *
 * ผู้ที่เข้าถึงเครื่องเซิร์ฟเวอร์ได้อยู่แล้วคือผู้ที่ควรมีอำนาจผูกบัญชี
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function list() {
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { login: "asc" }],
    select: { login: true, displayName: true, role: true, telegramUserId: true, status: true },
  });

  console.log("ผู้ใช้ในระบบและสถานะการผูกบัญชี Telegram\n");
  for (const user of users) {
    const reviewer = can(user.role, "evidence.review") ? "ตรวจหลักฐานได้" : "ตรวจหลักฐานไม่ได้";
    const linked = user.telegramUserId ? `ผูกแล้ว (${user.telegramUserId})` : "ยังไม่ผูก";
    console.log(
      `  ${user.login.padEnd(10)} ${user.role.padEnd(6)} ${reviewer.padEnd(18)} ${linked}${
        user.status === "ACTIVE" ? "" : " · ถูกระงับ"
      }`,
    );
  }
  console.log("\nกดปุ่มในแชทได้เฉพาะคนที่ผูกแล้วและตรวจหลักฐานได้");
}

async function main() {
  if (hasFlag("list")) {
    await list();
    return;
  }

  const login = arg("login");
  if (!login) {
    console.error("ต้องระบุ --login <ชื่อผู้ใช้>  หรือใช้ --list เพื่อดูรายชื่อ");
    process.exitCode = 1;
    return;
  }

  const user = await prisma.user.findFirst({
    where: { login },
    select: { id: true, login: true, displayName: true, role: true, organizationId: true },
  });
  if (!user) {
    console.error(`ไม่พบผู้ใช้ "${login}" — ดูรายชื่อด้วย --list`);
    process.exitCode = 1;
    return;
  }

  if (hasFlag("unlink")) {
    await prisma.user.update({ where: { id: user.id }, data: { telegramUserId: null } });
    await writeAudit(prisma, {
      organizationId: user.organizationId,
      actorId: null,
      action: "UPDATE",
      entityType: "User",
      entityId: user.id,
      after: { telegramUserId: null },
      reason: "ยกเลิกการผูกบัญชี Telegram ผ่านบรรทัดคำสั่ง",
    });
    console.log(`ยกเลิกการผูกบัญชี Telegram ของ ${user.login} แล้ว`);
    return;
  }

  const telegramUserId = arg("telegram")?.trim();
  if (!telegramUserId || !/^\d+$/.test(telegramUserId)) {
    console.error("ต้องระบุ --telegram <เลขบัญชี Telegram> ซึ่งเป็นตัวเลขล้วน");
    console.error("หาได้จาก getUpdates ที่ช่อง from.id ของข้อความที่คนนั้นพิมพ์");
    process.exitCode = 1;
    return;
  }

  if (!can(user.role, "evidence.review")) {
    console.error(
      `ผูกได้ แต่เตือนไว้ก่อน: บทบาท ${user.role} ไม่มีสิทธิ์ตรวจหลักฐาน กดปุ่มในแชทจะถูกปฏิเสธ`,
    );
  }

  const takenBy = await prisma.user.findFirst({
    where: { telegramUserId, NOT: { id: user.id } },
    select: { login: true },
  });
  if (takenBy) {
    console.error(`บัญชี Telegram นี้ผูกกับผู้ใช้ "${takenBy.login}" อยู่แล้ว ยกเลิกก่อนจึงจะย้ายได้`);
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { telegramUserId } });
  await writeAudit(prisma, {
    organizationId: user.organizationId,
    actorId: null,
    action: "UPDATE",
    entityType: "User",
    entityId: user.id,
    after: { telegramUserId },
    reason: "ผูกบัญชี Telegram ผ่านบรรทัดคำสั่ง",
  });

  console.log(`ผูกบัญชี Telegram ${telegramUserId} เข้ากับ ${user.login} (${user.displayName}) แล้ว`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
