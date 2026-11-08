import type { Actor } from "@/lib/auth/context";
import { orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { sanitizeLabel } from "./sanitize";

// จำกัดข้อมูลรายละเอียดต่อหมวดเพื่อไม่ให้ prompt ล้น context window
// ข้อมูลสรุปและจำนวนรวมยังครอบคลุมทั้งฐานข้อมูลเสมอ ผู้ใช้ถามเจาะจงต่อได้
const DETAIL_LIMIT = 20;

function includesAny(query: string, words: string[]): boolean {
  return words.some((word) => query.includes(word));
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

/**
 * ชั้นอ่านข้อมูลสำหรับ Owner AI
 *
 * ไฟล์นี้จงใจใช้เฉพาะ Prisma read operations เท่านั้น ไม่มี create/update/delete/upsert
 * และไม่คืน passwordHash, session token/hash, storageKey, checksum, idempotency key,
 * transaction reference, requestId, IP address หรือเนื้อหาแชทเก่าออกไปยังโมเดล
 */
export async function buildReadOnlyBusinessContext(actor: Actor, rawQuery: string) {
  const scope = orgScope(actor);
  const query = rawQuery.trim().toLocaleLowerCase("th-TH");
  const wantsAll = includesAny(query, ["ทั้งหมด", "ทั้งระบบ", "ฐานข้อมูล", "ทุกอย่าง", "ข้อมูลในระบบ"]);
  const wantsUsers = wantsAll || includesAny(query, ["ผู้ใช้", "user", "บัญชี", "ล็อกอิน", "role", "สิทธิ์"]);
  const wantsBills = wantsAll || includesAny(query, ["บิล", "โพย", "ลูกค้า", "รายการแทง", "เลขที่ซื้อ"]);
  const wantsResults = wantsAll || includesAny(query, ["ผลรางวัล", "เลขออก", "ออกรางวัล", "ผลหวย", "ลงผล"]);
  const wantsSettlement = wantsAll || includesAny(query, ["settlement", "ตรวจสอบยอด", "ปิดบัญชี", "คอมมิช", "ยอดสุทธิ"]);
  const wantsEvidence = wantsAll || includesAny(query, ["หลักฐาน", "สลิป", "ไฟล์แนบ", "payment", "ชำระ", "โอน"]);
  const wantsAudit = wantsAll || includesAny(query, ["audit", "ประวัติการตรวจ", "ประวัติการตรวจผลรางวัล", "ใครกรอก", "ใครแก้", "กิจกรรม"]);

  const [
    userGroups,
    agentGroups,
    drawGroups,
    billGroups,
    attachmentGroups,
    paymentGroups,
    resultGroups,
    settlementGroups,
    auditGroups,
    conversationCount,
    messageCount,
    prizeTypes,
    agents,
    draws,
    customerTitles,
  ] = await Promise.all([
    prisma.user.groupBy({ by: ["role", "status"], where: scope, _count: { _all: true } }),
    prisma.agent.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    prisma.draw.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    prisma.bill.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    prisma.billAttachment.groupBy({ by: ["type", "status"], where: scope, _count: { _all: true } }),
    prisma.billPayment.groupBy({
      by: ["verificationStatus"],
      where: scope,
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.result.groupBy({ by: ["status"], where: scope, _count: { _all: true } }),
    prisma.settlement.groupBy({
      by: ["status"],
      where: scope,
      _count: { _all: true },
      _sum: { gross: true, payout: true, commission: true, net: true },
    }),
    prisma.auditEvent.groupBy({ by: ["action"], where: scope, _count: { _all: true } }),
    prisma.ownerChatConversation.count({ where: scope }),
    prisma.ownerChatMessage.count({ where: { conversation: scope } }),
    prisma.prizeType.findMany({
      where: scope,
      orderBy: { code: "asc" },
      select: {
        code: true,
        name: true,
        digits: true,
        resultDigits: true,
        matchRule: true,
        payoutRate: true,
        maxStakePerItem: true,
        isActive: true,
      },
    }),
    prisma.agent.findMany({
      where: scope,
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, status: true, commissionRate: true, creditLimit: true, perNumberLimit: true },
    }),
    prisma.draw.findMany({
      where: scope,
      orderBy: { cutoffAt: "desc" },
      select: { id: true, name: true, status: true, opensAt: true, cutoffAt: true, lockedAt: true, closedAt: true },
    }),
    wantsBills
      ? prisma.bill.findMany({ where: scope, select: { title: true }, distinct: ["title"] })
      : Promise.resolve([]),
  ]);

  const mentionedAgents = agents.filter((agent) => {
    const code = agent.code.toLocaleLowerCase("th-TH");
    const name = agent.name.toLocaleLowerCase("th-TH");
    return query.includes(code) || (name.length >= 2 && query.includes(name));
  });
  const mentionedDraws = draws.filter((draw) => {
    const name = draw.name.toLocaleLowerCase("th-TH");
    return name.length >= 1 && query.includes(name);
  });
  const mentionedCustomers = customerTitles.filter((row) => {
    const title = row.title.trim().toLocaleLowerCase("th-TH");
    return title.length >= 2 && query.includes(title);
  });
  const billNumbers = [...new Set(query.match(/\b\d{8}\b/g) ?? [])];
  const hasSpecificBillFilter = billNumbers.length > 0 || mentionedCustomers.length > 0 || mentionedAgents.length > 0 || mentionedDraws.length > 0;

  const [users, bills, results, settlements, evidence, payments, audits] = await Promise.all([
    wantsUsers
      ? prisma.user.findMany({
          where: scope,
          orderBy: { createdAt: "desc" },
          take: DETAIL_LIMIT,
          select: { login: true, displayName: true, role: true, status: true, mustChangePassword: true, lastLoginAt: true, createdAt: true },
        })
      : Promise.resolve([]),
    wantsBills
      ? prisma.bill.findMany({
          where: {
            ...scope,
            ...(hasSpecificBillFilter
              ? {
                  OR: [
                    ...(billNumbers.length ? [{ billNumber: { in: billNumbers } }] : []),
                    ...mentionedCustomers.map((row) => ({ title: { equals: row.title, mode: "insensitive" as const } })),
                    ...(mentionedAgents.length ? [{ agentId: { in: mentionedAgents.map((agent) => agent.id) } }] : []),
                    ...(mentionedDraws.length ? [{ drawId: { in: mentionedDraws.map((draw) => draw.id) } }] : []),
                  ],
                }
              : {}),
          },
          orderBy: { createdAt: "desc" },
          take: DETAIL_LIMIT,
          select: {
            billNumber: true,
            title: true,
            status: true,
            totalStake: true,
            totalPayout: true,
            confirmedAt: true,
            cancelledAt: true,
            cancelReason: true,
            cancelRequestedAt: true,
            cancelRequestReason: true,
            createdAt: true,
            draw: { select: { name: true } },
            agent: { select: { code: true, name: true } },
            createdBy: { select: { displayName: true } },
            items: {
              orderBy: { createdAt: "asc" },
              select: { number: true, stake: true, payoutRateSnapshot: true, isWinner: true, payout: true, prizeType: { select: { name: true } } },
            },
          },
        })
      : Promise.resolve([]),
    wantsResults
      ? prisma.result.findMany({
          where: { ...scope, ...(mentionedDraws.length ? { drawId: { in: mentionedDraws.map((draw) => draw.id) } } : {}) },
          orderBy: { enteredAt: "desc" },
          take: DETAIL_LIMIT,
          select: { value: true, version: true, status: true, enteredAt: true, checkedAt: true, rejectReason: true, draw: { select: { name: true } }, prizeType: { select: { name: true } }, maker: { select: { displayName: true } }, checker: { select: { displayName: true } } },
        })
      : Promise.resolve([]),
    wantsSettlement
      ? prisma.settlement.findMany({
          where: { ...scope, ...(mentionedDraws.length ? { drawId: { in: mentionedDraws.map((draw) => draw.id) } } : {}), ...(mentionedAgents.length ? { agentId: { in: mentionedAgents.map((agent) => agent.id) } } : {}) },
          orderBy: { calculatedAt: "desc" },
          take: DETAIL_LIMIT,
          select: { gross: true, payout: true, commission: true, net: true, commissionRateSnapshot: true, status: true, calculatedAt: true, reconciledAt: true, approvedAt: true, draw: { select: { name: true } }, agent: { select: { code: true, name: true } }, reconciledBy: { select: { displayName: true } }, approvedBy: { select: { displayName: true } } },
        })
      : Promise.resolve([]),
    wantsEvidence
      ? prisma.billAttachment.findMany({
          where: scope,
          orderBy: { createdAt: "desc" },
          take: DETAIL_LIMIT,
          select: { type: true, originalName: true, mimeType: true, fileSize: true, status: true, verifiedAt: true, rejectionReason: true, createdAt: true, bill: { select: { billNumber: true, title: true } }, uploadedBy: { select: { displayName: true } }, verifiedBy: { select: { displayName: true } } },
        })
      : Promise.resolve([]),
    wantsEvidence
      ? prisma.billPayment.findMany({
          where: scope,
          orderBy: { createdAt: "desc" },
          take: DETAIL_LIMIT,
          select: { amount: true, paidAt: true, paymentMethod: true, bankName: true, verificationStatus: true, verifiedAt: true, rejectionReason: true, createdAt: true, bill: { select: { billNumber: true, title: true } }, verifiedBy: { select: { displayName: true } } },
        })
      : Promise.resolve([]),
    wantsAudit
      ? prisma.auditEvent.findMany({
          where: scope,
          orderBy: { createdAt: "desc" },
          take: DETAIL_LIMIT,
          select: { action: true, entityType: true, entityId: true, reason: true, createdAt: true, actor: { select: { displayName: true, role: true } } },
        })
      : Promise.resolve([]),
  ]);

  return {
    accessMode: "READ_ONLY" as const,
    organizationScope: actor.organizationId,
    queryIntent: {
      wantsAll,
      includedDetailModules: [
        wantsUsers && "users",
        wantsBills && "bills_and_items",
        wantsResults && "results",
        wantsSettlement && "settlements",
        wantsEvidence && "evidence_and_payments",
        wantsAudit && "audit",
      ].filter(Boolean),
    },
    safety: {
      mutationToolsAvailable: false,
      excludedSensitiveFields: [
        "passwordHash",
        "session/tokenHash",
        "storageKey/checksum/idempotencyKey",
        "transactionReference",
        "requestId/ipAddress/userAgent",
        "chat message content",
        "raw audit before/after JSON",
      ],
      detailLimitPerModule: DETAIL_LIMIT,
    },
    catalog: {
      users: userGroups.map((row) => ({ role: row.role, status: row.status, count: row._count._all })),
      agents: agentGroups.map((row) => ({ status: row.status, count: row._count._all })),
      prizeTypes: prizeTypes.length,
      draws: drawGroups.map((row) => ({ status: row.status, count: row._count._all })),
      bills: billGroups.map((row) => ({ status: row.status, count: row._count._all })),
      attachments: attachmentGroups.map((row) => ({ type: row.type, status: row.status, count: row._count._all })),
      payments: paymentGroups.map((row) => ({ status: row.verificationStatus, count: row._count._all, amount: Number(row._sum.amount ?? 0).toFixed(2) })),
      results: resultGroups.map((row) => ({ status: row.status, count: row._count._all })),
      settlements: settlementGroups.map((row) => ({ status: row.status, count: row._count._all, gross: Number(row._sum.gross ?? 0).toFixed(2), payout: Number(row._sum.payout ?? 0).toFixed(2), commission: Number(row._sum.commission ?? 0).toFixed(2), net: Number(row._sum.net ?? 0).toFixed(2) })),
      audit: auditGroups.map((row) => ({ action: row.action, count: row._count._all })),
      ownerChat: { conversations: conversationCount, messages: messageCount },
    },
    rulebook: prizeTypes.map((row) => ({ code: row.code, name: sanitizeLabel(row.name), digits: row.digits, resultDigits: row.resultDigits ?? row.digits, matchRule: row.matchRule, payoutRate: row.payoutRate.toFixed(4), maxStakePerItem: row.maxStakePerItem?.toFixed(2) ?? null, isActive: row.isActive })),
    directory: {
      agents: agents.map((row) => ({ code: row.code, name: sanitizeLabel(row.name), status: row.status, commissionRate: row.commissionRate.toFixed(4), creditLimit: row.creditLimit?.toFixed(2) ?? null, perNumberLimit: row.perNumberLimit?.toFixed(2) ?? null })),
      draws: draws.slice(0, DETAIL_LIMIT).map((row) => ({ name: sanitizeLabel(row.name), status: row.status, opensAt: row.opensAt.toISOString(), cutoffAt: row.cutoffAt.toISOString(), lockedAt: iso(row.lockedAt), closedAt: iso(row.closedAt) })),
      drawsTruncated: draws.length > DETAIL_LIMIT,
    },
    details: {
      users: users.map((row) => ({ login: row.login, displayName: sanitizeLabel(row.displayName), role: row.role, status: row.status, mustChangePassword: row.mustChangePassword, lastLoginAt: iso(row.lastLoginAt), createdAt: row.createdAt.toISOString() })),
      bills: bills.map((bill) => ({ billNumber: bill.billNumber, customerReference: sanitizeLabel(bill.title), status: bill.status, draw: sanitizeLabel(bill.draw.name), agent: `${bill.agent.code} · ${sanitizeLabel(bill.agent.name)}`, createdBy: sanitizeLabel(bill.createdBy.displayName), totalStake: bill.totalStake.toFixed(2), totalPayout: bill.totalPayout.toFixed(2), confirmedAt: iso(bill.confirmedAt), cancelledAt: iso(bill.cancelledAt), cancelReason: sanitizeLabel(bill.cancelReason), cancelRequestedAt: iso(bill.cancelRequestedAt), cancelRequestReason: sanitizeLabel(bill.cancelRequestReason), createdAt: bill.createdAt.toISOString(), items: bill.items.map((item) => ({ prizeType: sanitizeLabel(item.prizeType.name), number: item.number, stake: item.stake.toFixed(2), payoutRate: item.payoutRateSnapshot.toFixed(4), isWinner: item.isWinner, payout: item.payout.toFixed(2) })) })),
      results: results.map((row) => ({ draw: sanitizeLabel(row.draw.name), prizeType: sanitizeLabel(row.prizeType.name), value: row.value, version: row.version, status: row.status, maker: sanitizeLabel(row.maker.displayName), checker: sanitizeLabel(row.checker?.displayName), enteredAt: row.enteredAt.toISOString(), checkedAt: iso(row.checkedAt), rejectReason: sanitizeLabel(row.rejectReason) })),
      settlements: settlements.map((row) => ({ draw: sanitizeLabel(row.draw.name), agent: `${row.agent.code} · ${sanitizeLabel(row.agent.name)}`, gross: row.gross.toFixed(2), payout: row.payout.toFixed(2), commission: row.commission.toFixed(2), net: row.net.toFixed(2), commissionRate: row.commissionRateSnapshot.toFixed(4), status: row.status, calculatedAt: row.calculatedAt.toISOString(), reconciledBy: sanitizeLabel(row.reconciledBy?.displayName), reconciledAt: iso(row.reconciledAt), approvedBy: sanitizeLabel(row.approvedBy?.displayName), approvedAt: iso(row.approvedAt) })),
      evidence: evidence.map((row) => ({ billNumber: row.bill.billNumber, customerReference: sanitizeLabel(row.bill.title), type: row.type, originalName: sanitizeLabel(row.originalName), mimeType: row.mimeType, fileSize: row.fileSize, status: row.status, uploadedBy: sanitizeLabel(row.uploadedBy.displayName), verifiedBy: sanitizeLabel(row.verifiedBy?.displayName), verifiedAt: iso(row.verifiedAt), rejectionReason: sanitizeLabel(row.rejectionReason), createdAt: row.createdAt.toISOString() })),
      payments: payments.map((row) => ({ billNumber: row.bill.billNumber, customerReference: sanitizeLabel(row.bill.title), amount: row.amount.toFixed(2), paidAt: row.paidAt.toISOString(), paymentMethod: sanitizeLabel(row.paymentMethod), bankName: sanitizeLabel(row.bankName), status: row.verificationStatus, verifiedBy: sanitizeLabel(row.verifiedBy?.displayName), verifiedAt: iso(row.verifiedAt), rejectionReason: sanitizeLabel(row.rejectionReason), createdAt: row.createdAt.toISOString() })),
      audit: audits.map((row) => ({ action: row.action, entityType: sanitizeLabel(row.entityType), entityId: row.entityId, actor: sanitizeLabel(row.actor?.displayName), actorRole: row.actor?.role ?? null, reason: sanitizeLabel(row.reason), createdAt: row.createdAt.toISOString() })),
    },
  };
}
