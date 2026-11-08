import { Prisma } from "@prisma/client";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/auth/context";

/**
 * ข้อมูลตั้งต้นสำหรับ integration test
 *
 * สร้างชุดข้อมูลของตัวเองทุกครั้ง ไม่พึ่ง prisma db seed
 * เพราะ seed มีไว้สำหรับ development และอาจเปลี่ยนเมื่อไรก็ได้
 * ถ้า test ผูกกับ seed การแก้ seed จะทำให้ test พังโดยไม่เกี่ยวกับโค้ดที่แก้
 */

const PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$notarealhash$notarealhash";

/**
 * ล้างตารางข้อมูลทั้งหมด
 *
 * ใช้ TRUNCATE CASCADE เพราะเร็วกว่า deleteMany และไม่ต้องไล่ลำดับ FK เอง
 * _prisma_migrations ไม่ถูกแตะ เพราะเป็นประวัติ migration ไม่ใช่ข้อมูลทดสอบ
 */
export async function resetDatabase(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("ไม่พบ DATABASE_URL สำหรับ integration test");
  }

  const schema = new URL(connectionString).searchParams.get("schema");
  if (!schema?.startsWith("integration_test")) {
    throw new Error(
      "ปฏิเสธการล้างฐานข้อมูล: integration test ต้องทำงานใน schema integration_test เท่านั้น",
    );
  }

  const schemaIdentifier = `"${schema.replaceAll('"', '""')}"`;
  const tables = [
    // ตารางใหม่ต้องเพิ่มที่นี่ด้วย ถึงแม้ CASCADE จะลามไปถึงเมื่อมี FK
    // เพราะตารางที่ไม่มี FK กลับมาหาชุดนี้จะไม่ถูกล้าง แล้วข้อมูลจะข้ามไฟล์เทส
    "direct_message_attachments",
    "direct_messages",
    "conversations",
    "owner_chat_messages",
    "owner_chat_conversations",
    "audit_events",
    "bill_attachments",
    "bill_payments",
    "settlements",
    "results",
    "bill_items",
    "bills",
    "draws",
    "prize_types",
    "agents",
    "sessions",
    "users",
    "organizations",
  ]
    .map((table) => `${schemaIdentifier}."${table}"`)
    .join(", ");

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE ${tables}
    RESTART IDENTITY CASCADE
  `);
}

export type Fixtures = Awaited<ReturnType<typeof createFixtures>>;

export async function createFixtures() {
  const org = await prisma.organization.create({
    data: { name: "องค์กรทดสอบ", timezone: "Asia/Bangkok" },
  });

  const mkUser = (login: string, displayName: string, role: Role) =>
    prisma.user.create({
      data: {
        organizationId: org.id,
        login,
        displayName,
        passwordHash: PASSWORD_HASH,
        role,
        mustChangePassword: false,
      },
    });

  const [owner, admin, agentUser1, agentUser2] = await Promise.all([
    mkUser("owner", "เจ้าของ", "OWNER"),
    mkUser("admin", "ผู้ดูแล", "ADMIN"),
    mkUser("agent1", "ตัวแทนหนึ่ง", "AGENT"),
    mkUser("agent2", "ตัวแทนสอง", "AGENT"),
  ]);

  const agent1 = await prisma.agent.create({
    data: {
      organizationId: org.id,
      code: "A001",
      name: "ตัวแทนหนึ่ง",
      commissionRate: new Prisma.Decimal("25"),
      userId: agentUser1.id,
    },
  });

  const agent2 = await prisma.agent.create({
    data: {
      organizationId: org.id,
      code: "A002",
      name: "ตัวแทนสอง",
      commissionRate: new Prisma.Decimal("20"),
      userId: agentUser2.id,
    },
  });

  // รางวัลสามแบบ ครอบทั้งสาม MatchRule
  const [threeTop, threeTod, runTop] = await Promise.all([
    prisma.prizeType.create({
      data: {
        organizationId: org.id,
        code: 1,
        name: "3 ตัวบน",
        digits: 3,
        matchRule: "EXACT",
        payoutRate: new Prisma.Decimal("900"),
      },
    }),
    prisma.prizeType.create({
      data: {
        organizationId: org.id,
        code: 2,
        name: "3 ตัวโต๊ด",
        digits: 3,
        matchRule: "PERMUTATION",
        payoutRate: new Prisma.Decimal("150"),
      },
    }),
    prisma.prizeType.create({
      data: {
        organizationId: org.id,
        code: 8,
        name: "วิ่งบน",
        // แทงหลักเดียว แต่เทียบกับเลข 3 ตัวบน จึงต้องประกาศผล 3 หลัก
        digits: 1,
        resultDigits: 3,
        matchRule: "CONTAINS_DIGIT",
        payoutRate: new Prisma.Decimal("3.2"),
      },
    }),
  ]);

  const now = new Date();
  const draw = await prisma.draw.create({
    data: {
      organizationId: org.id,
      name: "งวดทดสอบ",
      opensAt: new Date(now.getTime() - 3_600_000),
      cutoffAt: new Date(now.getTime() + 3_600_000),
      status: "OPEN",
    },
  });

  const actor = (
    user: { id: string; role: Role; displayName: string },
    agentId: string | null = null,
  ): Actor => ({
    userId: user.id,
    organizationId: org.id,
    role: user.role,
    displayName: user.displayName,
    agentId,
    mustChangePassword: false,
    requestId: "integration-test",
    ipAddress: "127.0.0.1",
  });

  return {
    org,
    draw,
    prizeTypes: { threeTop, threeTod, runTop },
    agents: { agent1, agent2 },
    users: { owner, admin, agentUser1, agentUser2 },
    actors: {
      OWNER: actor(owner),
      ADMIN: actor(admin),
      AGENT1: actor(agentUser1, agent1.id),
      AGENT2: actor(agentUser2, agent2.id),
    },
  };
}

/** เตรียมฐานข้อมูลให้สะอาดแล้วสร้างข้อมูลตั้งต้น ใช้ใน beforeEach */
export async function freshFixtures(): Promise<Fixtures> {
  await resetDatabase();
  return createFixtures();
}
