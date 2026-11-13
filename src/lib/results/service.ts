import { prisma } from "@/lib/db";
import { writeAudit, type TxClient } from "@/lib/audit";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { validateResultValue } from "./matching";
import { resultValueCount, storedResultValues } from "./values";
import {
  canCorrectInDrawStatus,
  correctionInvalidatesSettlement,
  shouldApproveCorrectionOnProposal,
  shouldApproveResultOnEntry,
} from "./policy";

async function invalidateSettlementAfterCorrection(
  tx: TxClient,
  actor: Actor,
  draw: { id: string; status: string },
): Promise<void> {
  if (!correctionInvalidatesSettlement(draw.status)) return;

  const reset = await tx.settlement.updateMany({
    where: { drawId: draw.id },
    data: {
      status: "DRAFT",
      reconciledById: null,
      reconciledAt: null,
      approvedById: null,
      approvedAt: null,
    },
  });

  await tx.draw.update({
    where: { id: draw.id },
    data: { status: "RESULT_PENDING" },
  });

  await writeAudit(tx, {
    organizationId: actor.organizationId,
    actorId: actor.userId,
    requestId: actor.requestId,
    ipAddress: actor.ipAddress,
    action: "UPDATE",
    entityType: "Draw",
    entityId: draw.id,
    before: { status: "SETTLED" },
    after: { status: "RESULT_PENDING", settlementsReset: reset.count },
    reason: "ผลรางวัลถูกแก้หลังคำนวณ ต้องคำนวณและตรวจสอบยอดใหม่",
  });
}

/**
 * ลงผลรางวัลแบบ One-step review
 *
 * Admin/Owner บันทึกและยืนยันผลในครั้งเดียว ลดขั้นตอนตรวจซ้ำ
 * ฟังก์ชัน approve/reject ยังรองรับ DRAFT เก่าที่อาจค้างจากระบบเวอร์ชันก่อน
 */

export async function listResults(actor: Actor, drawId: string) {
  requirePermission(actor, "bill.viewOwn");

  const draw = await prisma.draw.findFirst({
    where: { id: drawId, ...orgScope(actor) },
    select: { id: true, name: true, status: true, cutoffAt: true },
  });
  if (!draw) throw new NotFoundError("ไม่พบรอบ");

  const [prizeTypes, results] = await Promise.all([
    prisma.prizeType.findMany({
      where: {
        ...orgScope(actor),
        // เลขสลับเป็นเพียงปุ่มช่วยสร้างเลขของตัวบน ไม่ใช่ผลรางวัลแยก
        code: { notIn: [10, 11] },
        OR: [
          { isActive: true },
          // ประเภทที่ปิดรับใหม่แล้วยังต้องแสดง หากงวดนี้มีบิลหรือผลเดิมอยู่
          // เพื่อให้ตรวจผลบิลค้างและเปิดดูประวัติย้อนหลังได้ครบ
          { billItems: { some: { bill: { drawId: draw.id, status: { notIn: ["DRAFT", "CANCELLED"] } } } } },
          { results: { some: { drawId: draw.id } } },
        ],
      },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        digits: true,
        resultDigits: true,
        matchRule: true,
      },
    }),
    prisma.result.findMany({
      where: { drawId: draw.id, ...orgScope(actor) },
      orderBy: [{ prizeTypeId: "asc" }, { version: "desc" }],
      select: {
        id: true,
        prizeTypeId: true,
        value: true,
        values: true,
        version: true,
        status: true,
        rejectReason: true,
        maker: { select: { id: true, displayName: true } },
        checker: { select: { displayName: true } },
        enteredAt: true,
        checkedAt: true,
      },
    }),
  ]);

  // แสดงเฉพาะ version ล่าสุดของแต่ละประเภทรางวัล
  const latest = new Map<string, (typeof results)[number]>();
  // ผลที่มีผลบังคับอยู่จริง ซึ่งอาจไม่ใช่ version ล่าสุดเมื่อมีคำขอแก้ค้างอยู่
  // หน้าจอต้องแยกสองอย่างนี้ ไม่งั้นคำขอแก้ที่ยังไม่อนุมัติจะทำให้ช่องกรอกผลเปิดอีกครั้ง
  const approved = new Map<string, (typeof results)[number]>();
  for (const r of results) {
    if (!latest.has(r.prizeTypeId)) latest.set(r.prizeTypeId, r);
    if (r.status === "APPROVED" && !approved.has(r.prizeTypeId)) {
      approved.set(r.prizeTypeId, r);
    }
  }

  return {
    draw,
    prizeTypes,
    latestByPrizeType: latest,
    approvedByPrizeType: approved,
  };
}

export type BatchResultInput = { prizeTypeId: string; value?: string; values?: string[] };

/** บันทึกผลหลายรางวัลใน transaction เดียว — ถ้าแถวใดผิดจะไม่บันทึกทุกแถว */
export async function enterResultsBatch(
  actor: Actor,
  input: { drawId: string; results: BatchResultInput[] },
): Promise<{ autoApproved: boolean; count: number }> {
  requirePermission(actor, "result.enter");

  if (input.results.length === 0) throw new ValidationError("กรุณากรอกผลอย่างน้อย 1 รายการ");
  if (input.results.length > 50) throw new ValidationError("บันทึกผลได้ไม่เกิน 50 รายการต่อครั้ง");
  const prizeTypeIds = input.results.map((result) => result.prizeTypeId);
  if (new Set(prizeTypeIds).size !== prizeTypeIds.length) {
    throw new ValidationError("มีประเภทรางวัลซ้ำในคำขอ");
  }

  const [draw, prizeType] = await Promise.all([
    prisma.draw.findFirst({
      where: { id: input.drawId, ...orgScope(actor) },
      select: { id: true, status: true },
    }),
    prisma.prizeType.findMany({
      where: { id: { in: prizeTypeIds }, ...orgScope(actor) },
      select: {
        id: true,
        code: true,
        digits: true,
        resultDigits: true,
        matchRule: true,
        isActive: true,
      },
    }),
  ]);

  if (!draw) throw new NotFoundError("ไม่พบรอบ");
  if (prizeType.length !== input.results.length) throw new NotFoundError("ไม่พบประเภทรางวัลบางรายการ");

  // ลงผลได้เฉพาะรอบที่ปิดรับแล้ว เพื่อไม่ให้ผลรั่วก่อนปิดรับ
  if (draw.status !== "LOCKED" && draw.status !== "RESULT_PENDING") {
    throw new ConflictError("ลงผลได้เฉพาะรอบที่ปิดรับแล้วและยังไม่ปิดบัญชี");
  }

  const prizeTypeById = new Map(prizeType.map((item) => [item.id, item]));
  const validated = input.results.map((result) => {
    const type = prizeTypeById.get(result.prizeTypeId);
    if (!type) throw new NotFoundError("ไม่พบประเภทรางวัล");
    if (type.code === 10 || type.code === 11) {
      throw new ValidationError("เลขสลับเป็นตัวช่วยกรอกเลขตัวบน ไม่ต้องลงผลรางวัลแยก");
    }
    if (!type.isActive) throw new ConflictError(`รางวัล ${type.code} ถูกปิดใช้งานแล้ว`);
    const values = (result.values ?? [result.value ?? ""]).map((value) => value.trim()).filter(Boolean);
    const requiredCount = resultValueCount(type.code);
    if (values.length !== requiredCount) {
      throw new ValidationError(`รางวัล ${type.code}: ต้องกรอกเลขที่ออก ${requiredCount} เลข`);
    }
    if (new Set(values).size !== values.length) {
      throw new ValidationError(`รางวัล ${type.code}: เลขที่ออกต้องไม่ซ้ำกัน`);
    }
    for (const value of values) {
      const problem = validateResultValue({
        value,
        digits: type.digits,
        resultDigits: type.resultDigits,
        matchRule: type.matchRule,
      });
      if (problem) throw new ValidationError(`รางวัล ${type.code}: ${problem}`);
    }
    return { prizeTypeId: type.id, value: values[0]!, values };
  });

  return prisma.$transaction(async (tx) => {
    const autoApproved = shouldApproveResultOnEntry(actor.role);
    const now = new Date();
    for (const result of validated) {
      const previous = await tx.result.findFirst({
        where: { drawId: draw.id, prizeTypeId: result.prizeTypeId },
        orderBy: { version: "desc" },
        select: { version: true, status: true, value: true, values: true },
      });
      // ตรวจทุก version ไม่ใช่เฉพาะตัวล่าสุด มิฉะนั้นคำขอแก้ผลที่ยังเป็น DRAFT
      // จะกลายเป็นช่องให้กรอกผลทับโดยไม่ผ่านเส้นทางแก้ผลและไม่บันทึกเหตุผล
      const approvedAlready = await tx.result.findFirst({
        where: { drawId: draw.id, prizeTypeId: result.prizeTypeId, status: "APPROVED" },
        select: { id: true },
      });
      if (approvedAlready) {
        // การกรอกผลใช้สำหรับผลที่ยังไม่ประกาศเท่านั้น
        // ผลที่อนุมัติแล้วถูกใช้คำนวณเงินไปแล้ว ต้องแก้ผ่านเส้นทางเฉพาะ
        throw new ConflictError(
          "มีผลบางรางวัลได้รับการอนุมัติแล้ว กรุณาใช้เมนูแก้ผลที่ประกาศแล้ว",
        );
      }
      const created = await tx.result.create({
        data: {
          organizationId: actor.organizationId,
          drawId: draw.id,
          prizeTypeId: result.prizeTypeId,
          value: result.value,
          values: result.values,
          version: (previous?.version ?? 0) + 1,
          status: autoApproved ? "APPROVED" : "DRAFT",
          makerId: actor.userId,
          checkerId: autoApproved ? actor.userId : null,
          checkedAt: autoApproved ? now : null,
        },
        select: { id: true, value: true, values: true, version: true },
      });
      await writeAudit(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        action: "CREATE",
        entityType: "Result",
        entityId: created.id,
        before: previous ? { values: storedResultValues(previous), version: previous.version } : undefined,
        after: { values: created.values, version: created.version, status: autoApproved ? "APPROVED" : "DRAFT" },
      });
      if (autoApproved) {
        await writeAudit(tx, {
          organizationId: actor.organizationId,
          actorId: actor.userId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          action: "APPROVE",
          entityType: "Result",
          entityId: created.id,
          before: { status: previous?.status ?? null, previousVersion: previous?.version ?? null },
          after: { status: "APPROVED", values: created.values, version: created.version },
          reason: "บันทึกและยืนยันผลในขั้นตอนเดียว",
        });
      }
    }
    if (draw.status === "LOCKED") {
      await tx.draw.update({ where: { id: draw.id }, data: { status: "RESULT_PENDING" } });
    }
    return { autoApproved, count: validated.length };
  });
}

/** รองรับ Action เดิมที่บันทึกทีละรางวัล โดยใช้ transaction path เดียวกับ batch */
export async function enterResult(
  actor: Actor,
  input: { drawId: string; prizeTypeId: string; value: string },
): Promise<{ autoApproved: boolean }> {
  const result = await enterResultsBatch(actor, {
    drawId: input.drawId,
    results: [{ prizeTypeId: input.prizeTypeId, values: [input.value] }],
  });
  return { autoApproved: result.autoApproved };
}

/**
 * เสนอแก้ผลรางวัลที่ประกาศไปแล้ว (LOT-36)
 *
 * ไม่เขียนทับผลเดิมและไม่ลบทิ้ง แต่สร้าง version ถัดไปเพื่อเก็บประวัติ
 * Admin สร้าง DRAFT โดยผลเดิมยังมีผลจนกว่า Owner จะอนุมัติ
 * Owner สร้างผล APPROVED และใช้ผลใหม่ทันที
 *
 * Admin สร้างคำขอ DRAFT เพื่อรอ Owner อนุมัติ ส่วน Owner อนุมัติทันที
 */
export async function proposeResultCorrection(
  actor: Actor,
  input: { drawId: string; prizeTypeId: string; value?: string; values?: string[]; reason: string },
): Promise<{ resultId: string; version: number; autoApproved: boolean }> {
  requirePermission(actor, "result.proposeCorrection");

  const reason = input.reason.trim();
  if (reason === "") throw new ValidationError("ต้องระบุเหตุผลที่ขอแก้ผลรางวัล");

  const [draw, prizeType] = await Promise.all([
    prisma.draw.findFirst({
      where: { id: input.drawId, ...orgScope(actor) },
      select: { id: true, status: true },
    }),
    prisma.prizeType.findFirst({
      where: { id: input.prizeTypeId, ...orgScope(actor) },
      select: { id: true, code: true, digits: true, resultDigits: true, matchRule: true },
    }),
  ]);

  if (!draw) throw new NotFoundError("ไม่พบรอบ");
  if (!prizeType) throw new NotFoundError("ไม่พบประเภทรางวัล");
  if (!canCorrectInDrawStatus(draw.status)) {
    throw new ConflictError("รอบนี้ปิดบัญชีแล้ว แก้ผลรางวัลไม่ได้");
  }

  const values = (input.values ?? [input.value ?? ""]).map((value) => value.trim()).filter(Boolean);
  const requiredCount = resultValueCount(prizeType.code);
  if (values.length !== requiredCount) {
    throw new ValidationError(`รางวัล ${prizeType.code}: ต้องกรอกเลขที่ออก ${requiredCount} เลข`);
  }
  if (new Set(values).size !== values.length) {
    throw new ValidationError(`รางวัล ${prizeType.code}: เลขที่ออกต้องไม่ซ้ำกัน`);
  }
  for (const value of values) {
    const problem = validateResultValue({
      value,
      digits: prizeType.digits,
      resultDigits: prizeType.resultDigits,
      matchRule: prizeType.matchRule,
    });
    if (problem) throw new ValidationError(`รางวัล ${prizeType.code}: ${problem}`);
  }
  const value = values[0]!;

  return prisma.$transaction(async (tx) => {
    // ถามทีละคำถาม ไม่ใช้ Promise.all บน tx เดียวกัน
    // เพราะ transaction client ถือ connection เดียว การยิงพร้อมกันทำให้คิวรีซ้อนกัน
    const pending = await tx.result.findFirst({
      where: { drawId: draw.id, prizeTypeId: prizeType.id, status: "DRAFT" },
      select: { id: true },
    });
    // ผลที่มีผลบังคับอยู่ขณะนี้ — ไม่ใช่ version ล่าสุด เพราะ version ล่าสุด
    // อาจเป็นคำขอที่เพิ่งถูกตีกลับไป ซึ่งต้องเสนอใหม่ได้
    const approved = await tx.result.findFirst({
      where: { drawId: draw.id, prizeTypeId: prizeType.id, status: "APPROVED" },
      orderBy: { version: "desc" },
      select: { id: true, version: true, value: true, values: true },
    });
    const newest = await tx.result.findFirst({
      where: { drawId: draw.id, prizeTypeId: prizeType.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    if (pending) {
      throw new ConflictError("มีคำขอแก้ผลของรางวัลนี้ค้างอยู่แล้ว รอการอนุมัติหรือตีกลับก่อน");
    }
    if (!approved || !newest) {
      throw new ConflictError("รางวัลนี้ยังไม่มีผลที่อนุมัติแล้ว ใช้การลงผลตามปกติแทน");
    }
    const approvedValues = storedResultValues(approved);
    if (approvedValues.length === values.length && approvedValues.every((item, index) => item === values[index])) {
      throw new ValidationError("ค่าที่เสนอตรงกับผลเดิม ไม่มีอะไรต้องแก้");
    }
    const previous = { version: newest.version, values: approvedValues };

    const autoApproved = shouldApproveCorrectionOnProposal(actor.role);
    const now = new Date();
    const created = await tx.result.create({
      data: {
        organizationId: actor.organizationId,
        drawId: draw.id,
        prizeTypeId: prizeType.id,
        value,
        values,
        version: previous.version + 1,
        status: autoApproved ? "APPROVED" : "DRAFT",
        makerId: actor.userId,
        checkerId: autoApproved ? actor.userId : null,
        checkedAt: autoApproved ? now : null,
      },
      select: { id: true, version: true, value: true, values: true },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "CREATE",
      entityType: "Result",
      entityId: created.id,
      before: { values: previous.values, version: previous.version, status: "APPROVED" },
      after: { values, version: created.version, status: autoApproved ? "APPROVED" : "DRAFT" },
      reason: autoApproved
        ? `Owner แก้ผลที่ประกาศแล้วและให้มีผลทันที: ${reason}`
        : `เสนอแก้ผลที่ประกาศแล้ว: ${reason}`,
    });

    if (autoApproved) {
      await invalidateSettlementAfterCorrection(tx, actor, draw);
      await writeAudit(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        action: "APPROVE",
        entityType: "Result",
        entityId: created.id,
        before: { status: "DRAFT", supersedes: { values: previous.values, version: approved.version } },
        after: { status: "APPROVED", values: created.values, version: created.version },
        reason: `Owner แก้ผลและอนุมัติทันที: ${reason}`,
      });
    }

    return { resultId: created.id, version: created.version, autoApproved };
  });
}

export async function approveResult(actor: Actor, resultId: string): Promise<void> {
  requirePermission(actor, "result.approve");

  await prisma.$transaction(async (tx) => {
    const result = await tx.result.findFirst({
      where: { id: resultId, ...orgScope(actor) },
      select: {
        id: true,
        status: true,
        makerId: true,
        value: true,
        values: true,
        version: true,
        drawId: true,
        prizeTypeId: true,
      },
    });

    if (!result) throw new NotFoundError("ไม่พบผลรางวัล");
    // รองรับ retry และปุ่มจากหน้าที่เปิดค้างก่อนระบบเปลี่ยนเป็น one-step
    if (result.status === "APPROVED") return;
    if (result.status !== "DRAFT") throw new ConflictError("ผลนี้ถูกตรวจไปแล้ว");

    // version แรกคือการลงผลครั้งแรก ซึ่งจบในขั้นตอนเดียวได้
    // version ที่สูงกว่าและยังเป็น DRAFT คือคำขอแก้ของ Admin หรือข้อมูลค้างจากรุ่นก่อน
    const superseded =
      result.version > 1
        ? await tx.result.findFirst({
            where: {
              drawId: result.drawId,
              prizeTypeId: result.prizeTypeId,
              status: "APPROVED",
              version: { lt: result.version },
            },
            orderBy: { version: "desc" },
            select: { id: true, value: true, values: true, version: true },
          })
        : null;

    if (superseded) {
      requirePermission(actor, "result.approveCorrection");
      if (result.makerId === actor.userId && !shouldApproveCorrectionOnProposal(actor.role)) {
        throw new ForbiddenError("ผู้เสนอแก้ผลกับผู้อนุมัติต้องไม่ใช่คนเดียวกัน");
      }

      const draw = await tx.draw.findUniqueOrThrow({
        where: { id: result.drawId },
        select: { id: true, status: true },
      });
      if (!canCorrectInDrawStatus(draw.status)) {
        throw new ConflictError("รอบนี้ปิดบัญชีแล้ว แก้ผลรางวัลไม่ได้");
      }

      // ตัวเลขการเงินที่คำนวณไว้อ้างอิงผลเก่า จึงใช้ไม่ได้อีกตั้งแต่วินาทีนี้
      // ล้างสถานะการตรวจสอบยอดและดึงรอบกลับไปรอคำนวณใหม่ในทรานแซกชันเดียวกัน
      await invalidateSettlementAfterCorrection(tx, actor, draw);
    }

    await tx.result.update({
      where: { id: result.id },
      data: { status: "APPROVED", checkerId: actor.userId, checkedAt: new Date() },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "APPROVE",
      entityType: "Result",
      entityId: result.id,
      before: superseded
        ? { status: "DRAFT", supersedes: { values: storedResultValues(superseded), version: superseded.version } }
        : { status: "DRAFT" },
      after: { status: "APPROVED", values: storedResultValues(result), version: result.version },
      reason: superseded ? "อนุมัติการแก้ผลที่ประกาศแล้ว" : undefined,
    });
  });
}

export async function rejectResult(actor: Actor, resultId: string, reason: string): Promise<void> {
  requirePermission(actor, "result.approve");

  const trimmed = reason.trim();
  if (trimmed === "") throw new ValidationError("ต้องระบุเหตุผลที่ตีกลับ");

  await prisma.$transaction(async (tx) => {
    const result = await tx.result.findFirst({
      where: { id: resultId, ...orgScope(actor) },
      select: { id: true, status: true, makerId: true },
    });

    if (!result) throw new NotFoundError("ไม่พบผลรางวัล");
    if (result.status !== "DRAFT") throw new ConflictError("ผลนี้ถูกตรวจไปแล้ว");
    await tx.result.update({
      where: { id: result.id },
      data: {
        status: "REJECTED",
        checkerId: actor.userId,
        checkedAt: new Date(),
        rejectReason: trimmed,
      },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "REJECT",
      entityType: "Result",
      entityId: result.id,
      before: { status: "DRAFT" },
      after: { status: "REJECTED" },
      reason: trimmed,
    });
  });
}
