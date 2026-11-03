import { cookies, headers } from "next/headers";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { can, type Permission } from "./permissions";
import { SESSION_COOKIE_NAME, resolveSession } from "./session";
import { REQUEST_ID_HEADER } from "@/lib/requestId";

// กฎการมองเห็นอยู่ใน scope.ts เพื่อให้ทดสอบได้โดยไม่ต้องพึ่ง next/headers
export { auditScope, billScope, orgScope } from "./scope";

export type Actor = {
  userId: string;
  organizationId: string;
  role: Role;
  displayName: string;
  /** ไม่ null เฉพาะผู้ใช้บทบาท AGENT ที่ผูกกับ Agent แล้ว */
  agentId: string | null;
  mustChangePassword: boolean;
  /** ตัวตามรอย request เดียวกันจาก middleware ถึง Audit Log (LOT-38) */
  requestId: string | undefined;
  ipAddress: string | undefined;
};

/** คืน Actor ถ้ามี session ที่ใช้ได้ ไม่งั้นคืน null — ใช้กับหน้าที่เปิดสาธารณะได้ */
export async function getActor(): Promise<Actor | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = await resolveSession(token);
  if (!session) return null;

  const agent =
    session.user.role === "AGENT"
      ? await prisma.agent.findUnique({
          where: { userId: session.user.id },
          select: { id: true, status: true },
        })
      : null;

  // Agent ที่ถูกระงับเข้าใช้งานไม่ได้ แม้บัญชีผู้ใช้จะยัง ACTIVE
  if (session.user.role === "AGENT" && (!agent || agent.status !== "ACTIVE")) {
    return null;
  }

  const h = await headers();

  return {
    userId: session.user.id,
    organizationId: session.user.organizationId,
    role: session.user.role,
    displayName: session.user.displayName,
    agentId: agent?.id ?? null,
    mustChangePassword: session.user.mustChangePassword,
    requestId: h.get(REQUEST_ID_HEADER) ?? undefined,
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  };
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new UnauthorizedError();
  return actor;
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor.role, permission)) {
    throw new ForbiddenError();
  }
}

export async function requirePermissionAsActor(permission: Permission): Promise<Actor> {
  const actor = await requireActor();
  requirePermission(actor, permission);
  return actor;
}
