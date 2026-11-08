import "dotenv/config";
import { prisma } from "../src/lib/db";
import { mockDataStatus, setMockDataEnabled } from "../src/lib/mock-data";

async function main() {
  const enabled = process.argv.includes("--off") ? false : process.argv.includes("--on") ? true : null;
  if (enabled === null) throw new Error("ระบุ --on หรือ --off");
  const organization = await prisma.organization.findFirst({
    where: { isActive: true },
    select: { id: true },
  });
  if (!organization) throw new Error("ไม่พบองค์กรที่ใช้งานอยู่");
  const owner = await prisma.user.findFirst({
    where: { organizationId: organization.id, role: "OWNER", status: "ACTIVE" },
    select: { id: true },
  });
  if (!owner) throw new Error("ไม่พบบัญชี Owner");
  const before = await mockDataStatus(organization.id);
  const after = await setMockDataEnabled({ userId: owner.id, organizationId: organization.id }, enabled);
  console.log(JSON.stringify({ before, after }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
