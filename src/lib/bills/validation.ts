import { Prisma } from "@prisma/client";
import { MAX_STAKE_PER_ITEM, MIN_STAKE_PER_ITEM } from "./betting";
import type { MatchRule } from "@prisma/client";

/**
 * กฎตรวจรายการบิล ตามเอกสารบทที่ 3 (Workflow สร้างบิล ข้อ 3)
 *
 * "ระบบตรวจรูปแบบ เลขซ้ำ วงเงิน Agent วงเงินต่อเลข และเวลาปิดรับแบบ Real Time"
 *
 * ไฟล์นี้เป็น pure function ทั้งหมด ไม่แตะฐานข้อมูล เพื่อให้เรียกได้ทั้งฝั่ง
 * client (ตรวจทันทีขณะพิมพ์) และฝั่ง server (ตรวจซ้ำก่อนบันทึกจริง)
 * การตรวจฝั่ง client เป็นเพียงความสะดวก ฝั่ง server คือด่านที่เชื่อถือได้
 */

export type PrizeTypeRule = {
  id: string;
  code: number;
  name: string;
  digits: number;
  matchRule: MatchRule;
  payoutRate: Prisma.Decimal;
  maxStakePerItem: Prisma.Decimal | null;
};

export type DraftItem = {
  prizeTypeId: string;
  number: string;
  stake: Prisma.Decimal;
};

export type AgentLimits = {
  creditLimit: Prisma.Decimal | null;
  perNumberLimit: Prisma.Decimal | null;
};

export type ValidationIssue = {
  /** ตำแหน่งรายการที่มีปัญหา null = ปัญหาระดับบิล */
  itemIndex: number | null;
  code:
    | "UNKNOWN_PRIZE_TYPE"
    | "NUMBER_NOT_NUMERIC"
    | "NUMBER_WRONG_LENGTH"
    | "STAKE_NOT_POSITIVE"
    | "STAKE_BELOW_MINIMUM"
    | "STAKE_OVER_ITEM_LIMIT"
    | "DUPLICATE_ITEM"
    | "NUMBER_CLOSED"
    | "NUMBER_FULL"
    | "OVER_PER_NUMBER_LIMIT"
    | "OVER_CREDIT_LIMIT"
    | "DRAW_NOT_OPEN"
    | "PAST_CUTOFF"
    | "EMPTY_BILL";
  message: string;
};

const ZERO = new Prisma.Decimal(0);

/** รูปแบบเลข: ต้องเป็นตัวเลขล้วน และยาวเท่ากับ digits ของรางวัลนั้นพอดี */
function validateNumberFormat(
  item: DraftItem,
  rule: PrizeTypeRule,
  index: number,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!/^\d+$/.test(item.number)) {
    issues.push({
      itemIndex: index,
      code: "NUMBER_NOT_NUMERIC",
      message: `รายการที่ ${index + 1}: เลขต้องเป็นตัวเลขเท่านั้น`,
    });
    return issues;
  }

  if (item.number.length !== rule.digits) {
    issues.push({
      itemIndex: index,
      code: "NUMBER_WRONG_LENGTH",
      message: `รายการที่ ${index + 1}: ${rule.name} ต้องกรอก ${rule.digits} หลัก (กรอกมา ${item.number.length} หลัก)`,
    });
  }

  return issues;
}

/**
 * คีย์สำหรับตรวจรายการซ้ำ
 *
 * รางวัลแบบโต๊ด (matchRule = PERMUTATION) ถือว่า 123 กับ 321 เป็นเลขเดียวกัน
 * จึงเรียงหลักก่อนทำคีย์ ไม่งั้นผู้ใช้แทงซ้ำโดยไม่รู้ตัวและจ่ายสองเท่า
 */
export function dedupeKey(prizeTypeId: string, numberValue: string, matchRule: MatchRule): string {
  // รางวัลโต๊ดเท่านั้นที่ถือว่าสลับตำแหน่งแล้วเป็นเลขเดียวกัน
  const normalized = matchRule === "PERMUTATION" ? [...numberValue].sort().join("") : numberValue;
  return `${prizeTypeId}:${normalized}`;
}

export type ValidateInput = {
  items: readonly DraftItem[];
  rules: ReadonlyMap<string, PrizeTypeRule>;
  agent: AgentLimits;
  draw: { status: string; cutoffAt: Date };
  /** ยอดที่ Agent รายนี้ใช้ไปแล้วในรอบนี้จากบิลใบอื่น */
  existingStakeInDraw: Prisma.Decimal;
  now: Date;
  /** เลขเต็ม/เลขอั้นของงวด คีย์เดียวกับ dedupeKey */
  restrictions?: ReadonlyMap<string, NumberRestriction>;
  /**
   * เพดานรับต่อเลขของทั้งงวด และยอดที่บิลใบอื่นแทงเลขนั้นไปแล้ว (คีย์เดียวกับ dedupeKey)
   * ไม่ส่งหรือ cap = null คือไม่จำกัด
   */
  numberCap?: { cap: Prisma.Decimal | null; used: ReadonlyMap<string, Prisma.Decimal> };
};

export type NumberRestriction = {
  kind: "CLOSED" | "REDUCED_RATE";
  payoutRate: Prisma.Decimal | null;
};

function formatBaht(value: Prisma.Decimal): string {
  return Number(value).toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

export function validateBill(input: ValidateInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (input.items.length === 0) {
    issues.push({ itemIndex: null, code: "EMPTY_BILL", message: "บิลต้องมีอย่างน้อยหนึ่งรายการ" });
  }

  if (input.draw.status !== "OPEN") {
    issues.push({
      itemIndex: null,
      code: "DRAW_NOT_OPEN",
      message: "รอบนี้ปิดรับรายการแล้ว",
    });
  }

  if (input.now.getTime() >= input.draw.cutoffAt.getTime()) {
    issues.push({
      itemIndex: null,
      code: "PAST_CUTOFF",
      message: "เลยเวลาปิดรับของรอบนี้แล้ว",
    });
  }

  const seen = new Set<string>();
  const stakePerNumber = new Map<string, Prisma.Decimal>();
  let billTotal = ZERO;

  for (const [index, item] of input.items.entries()) {
    const rule = input.rules.get(item.prizeTypeId);

    if (!rule) {
      issues.push({
        itemIndex: index,
        code: "UNKNOWN_PRIZE_TYPE",
        message: `รายการที่ ${index + 1}: ไม่พบประเภทรางวัลนี้`,
      });
      continue;
    }

    issues.push(...validateNumberFormat(item, rule, index));

    if (item.stake.lessThanOrEqualTo(ZERO)) {
      issues.push({
        itemIndex: index,
        code: "STAKE_NOT_POSITIVE",
        message: `รายการที่ ${index + 1}: ยอดเดิมพันต้องมากกว่า 0`,
      });
      continue;
    }

    if (item.stake.lessThan(MIN_STAKE_PER_ITEM)) {
      issues.push({
        itemIndex: index,
        code: "STAKE_BELOW_MINIMUM",
        message: `รายการที่ ${index + 1}: ยอดเดิมพันขั้นต่ำ ${MIN_STAKE_PER_ITEM.toLocaleString("th-TH")} บาท`,
      });
      continue;
    }

    if (item.stake.greaterThan(MAX_STAKE_PER_ITEM)) {
      issues.push({
        itemIndex: index,
        code: "STAKE_OVER_ITEM_LIMIT",
        message: `รายการที่ ${index + 1}: ยอดเดิมพันต่อรายการต้องไม่เกิน ${MAX_STAKE_PER_ITEM.toLocaleString("th-TH")} บาท`,
      });
      continue;
    }

    if (rule.maxStakePerItem !== null && item.stake.greaterThan(rule.maxStakePerItem)) {
      issues.push({
        itemIndex: index,
        code: "STAKE_OVER_ITEM_LIMIT",
        message: `รายการที่ ${index + 1}: ${rule.name} รับสูงสุด ${rule.maxStakePerItem.toFixed(2)} ต่อรายการ`,
      });
    }

    const key = dedupeKey(item.prizeTypeId, item.number, rule.matchRule);
    if (input.restrictions?.get(key)?.kind === "CLOSED") {
      issues.push({
        itemIndex: index,
        code: "NUMBER_CLOSED",
        message: `รายการที่ ${index + 1}: ${rule.name} เลข ${item.number} เป็นเลขเต็ม ปิดรับแล้ว`,
      });
    }
    const cap = input.numberCap?.cap ?? null;
    if (cap !== null && input.restrictions?.get(key)?.kind !== "CLOSED") {
      const used = input.numberCap?.used.get(key) ?? ZERO;
      const remaining = cap.minus(used);
      if (remaining.lessThanOrEqualTo(0)) {
        issues.push({
          itemIndex: index,
          code: "NUMBER_FULL",
          message: `รายการที่ ${index + 1}: ${rule.name} เลข ${item.number} เป็นเลขเต็ม ยอดครบ ${formatBaht(cap)} บาทแล้ว ปิดรับ`,
        });
      } else if (item.stake.greaterThan(remaining)) {
        issues.push({
          itemIndex: index,
          code: "NUMBER_FULL",
          message: `รายการที่ ${index + 1}: ${rule.name} เลข ${item.number} รับได้อีก ${formatBaht(remaining)} บาท (เพดานเลขละ ${formatBaht(cap)} บาท)`,
        });
      }
    }
    if (seen.has(key)) {
      issues.push({
        itemIndex: index,
        code: "DUPLICATE_ITEM",
        message: `รายการที่ ${index + 1}: ซ้ำกับรายการก่อนหน้า (${rule.name} ${item.number})`,
      });
    }
    seen.add(key);

    stakePerNumber.set(key, (stakePerNumber.get(key) ?? ZERO).plus(item.stake));
    billTotal = billTotal.plus(item.stake);
  }

  if (input.agent.perNumberLimit !== null) {
    for (const [key, total] of stakePerNumber) {
      if (total.greaterThan(input.agent.perNumberLimit)) {
        const shown = key.split(":")[1] ?? key;
        issues.push({
          itemIndex: null,
          code: "OVER_PER_NUMBER_LIMIT",
          message: `เลข ${shown} รวม ${total.toFixed(2)} เกินวงเงินต่อเลข ${input.agent.perNumberLimit.toFixed(2)}`,
        });
      }
    }
  }

  if (input.agent.creditLimit !== null) {
    const afterThisBill = input.existingStakeInDraw.plus(billTotal);
    if (afterThisBill.greaterThan(input.agent.creditLimit)) {
      issues.push({
        itemIndex: null,
        code: "OVER_CREDIT_LIMIT",
        message: `ยอดรวมในรอบนี้ ${afterThisBill.toFixed(2)} เกินวงเงิน ${input.agent.creditLimit.toFixed(2)}`,
      });
    }
  }

  return issues;
}

export function totalStake(items: readonly DraftItem[]): Prisma.Decimal {
  return items.reduce<Prisma.Decimal>((sum, item) => sum.plus(item.stake), ZERO);
}
