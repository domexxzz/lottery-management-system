import { cookies, headers } from "next/headers";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { can, type Permission } from "./permissions";
import { SESSION_COOKIE_NAME, resolveSession } from "./session";

export type Actor = {
  userId: string;
  organizationId: string;
  role: Role;
  displayName: string;
  /** ไม่ null เฉพาะผู้ใช้บทบาท AGENT ที่ผูกกับ Agent แล้ว */
  agentId: string | null;
  mustChangePassword: boolean;
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

  return {
    userId: session.user.id,
    organizationId: session.user.organizationId,
    role: session.user.role,
    displayName: session.user.displayName,
    agentId: agent?.id ?? null,
    mustChangePassword: session.user.mustChangePassword,
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

/**
 * ขอบเขตที่ทุก query เกี่ยวกับบิลต้องใช้ (เอกสารบทที่ 2)
 *
 * ห้ามเขียน prisma.bill.findMany({ where: { drawId } }) ตรง ๆ ที่ใดก็ตาม
 * ต้องเป็น prisma.bill.findMany({ where: { ...billScope(actor), drawId } }) เสมอ
 *
 * Agent เห็นเฉพาะบิลของตนเอง บทบาทอื่นเห็นทั้งองค์กรแต่ไม่ข้ามองค์กร
 */
export function billScope(actor: Actor): Prisma.BillWhereInput {
  if (actor.role === "AGENT") {
    // agentId เป็น null ไม่ได้สำหรับ AGENT ที่ผ่าน getActor มาแล้ว
    // ใส่ค่าที่ไม่มีทางตรงไว้กันพลาด ดีกว่าปล่อยให้เห็นทั้งองค์กร
    return { organizationId: actor.organizationId, agentId: actor.agentId ?? "__no_agent__" };
  }
  return { organizationId: actor.organizationId };
}

/** ขอบเขตสำหรับตารางที่มี organizationId ตรง ๆ และไม่ได้แยกตาม Agent */
export function orgScope(actor: Actor): { organizationId: string } {
  return { organizationId: actor.organizationId };
}

/**
 * ขอบเขตของ Audit Log
 * Agent เห็นเฉพาะเหตุการณ์ของบิลตนเอง บทบาทอื่นที่มี audit.viewAll เห็นทั้งองค์กร
 */
export function auditScope(actor: Actor): Prisma.AuditEventWhereInput {
  if (can(actor.role, "audit.viewAll")) {
    return { organizationId: actor.organizationId };
  }
  return { organizationId: actor.organizationId, actorId: actor.userId };
}

export async function clientIp(): Promise<string | undefined> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
}
