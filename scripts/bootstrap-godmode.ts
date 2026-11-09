import "dotenv/config";
import { prisma } from "../src/lib/db";
import { hashPassword, validatePasswordStrength } from "../src/lib/auth/password";

async function main() {
  const password = process.env.GODMODE_PASSWORD ?? process.env.SEED_PASSWORD;
  if (!password) throw new Error("ต้องตั้ง GODMODE_PASSWORD หรือ SEED_PASSWORD ก่อนสร้างบัญชี Godmode");
  const passwordError = validatePasswordStrength(password);
  if (passwordError) throw new Error(passwordError);

  const requestedOrganizationId = process.env.GODMODE_ORGANIZATION_ID?.trim();
  const organizations = await prisma.organization.findMany({
    where: requestedOrganizationId ? { id: requestedOrganizationId } : undefined,
    select: { id: true, name: true },
    take: 2,
  });
  if (organizations.length === 0) throw new Error("ไม่พบองค์กรสำหรับสร้างบัญชี Godmode");
  if (!requestedOrganizationId && organizations.length > 1) {
    throw new Error("มีหลายองค์กร กรุณาตั้ง GODMODE_ORGANIZATION_ID ให้ชัดเจน");
  }

  const organization = organizations[0]!;
  const login = (process.env.GODMODE_LOGIN ?? "godmode").trim().toLowerCase();
  const displayName = (process.env.GODMODE_DISPLAY_NAME ?? "Godmode").trim();
  if (!/^[a-z0-9._-]{3,64}$/.test(login)) throw new Error("GODMODE_LOGIN ไม่ถูกต้อง");
  if (!displayName) throw new Error("GODMODE_DISPLAY_NAME ต้องไม่ว่าง");

  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { organizationId_login: { organizationId: organization.id, login } },
      select: { id: true },
    });
    const saved = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: { displayName, passwordHash, role: "GODMODE", status: "ACTIVE", mustChangePassword: true },
          select: { id: true, login: true, displayName: true, role: true },
        })
      : await tx.user.create({
          data: { organizationId: organization.id, login, displayName, passwordHash, role: "GODMODE", mustChangePassword: true },
          select: { id: true, login: true, displayName: true, role: true },
        });

    await tx.auditEvent.create({
      data: {
        organizationId: organization.id,
        actorId: saved.id,
        action: existing ? "UPDATE" : "CREATE",
        entityType: "User",
        entityId: saved.id,
        after: { login: saved.login, displayName: saved.displayName, role: saved.role },
        reason: "Bootstrap Godmode account",
      },
    });
    return saved;
  });

  console.log(`Godmode พร้อมใช้งาน: @${user.login} · ${organization.name}`);
  console.log("ระบบจะบังคับเปลี่ยนรหัสผ่านในการเข้าสู่ระบบครั้งแรก");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
