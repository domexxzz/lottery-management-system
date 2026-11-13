/**
 * ตรรกะของหน้าแทงเลขและหน้าโพยของ Agent
 *
 * เป็น pure function ทั้งหมด ไม่ import Prisma runtime เพื่อให้ใช้ได้ทั้งฝั่ง client และ server
 */

export type MatchRuleName = "EXACT" | "PERMUTATION" | "CONTAINS_DIGIT";

export type BetPrizeType = {
  id: string;
  code: number;
  name: string;
  digits: number;
  matchRule: MatchRuleName;
  payoutRate: string;
};

export type BetEntry = {
  prizeTypeId: string;
  number: string;
  /** ยอดเดิมพันเป็นจำนวนเต็มบาท */
  stake: number;
};

export type BetGroup = {
  key: string;
  label: string;
  digits: number;
  prizeTypes: BetPrizeType[];
};

/** ยอดเดิมพันสูงสุดของเลขหนึ่งรายการ ส่วนยอดรวมทั้งบิลไม่จำกัดด้วยค่านี้ */
export const MAX_STAKE_PER_ITEM = 1_000;

/** ยอดเดิมพันขั้นต่ำของเลขหนึ่งรายการ ทั้งจากปุ่มลัดและการกรอกเอง */
export const MIN_STAKE_PER_ITEM = 5;

/** รหัสธุรกิจของประเภทที่ต้องแตกเลขสลับทุกชุดเป็นคนละรายการ */
const SWAP_PRIZE_CODES = new Set([10, 11]);

/** เลขที่ใช้เทียบความซ้ำ — รางวัลโต๊ดถือว่าสลับหลักแล้วเป็นเลขเดียวกัน */
export function normalizedNumber(numberValue: string, matchRule: MatchRuleName): string {
  return matchRule === "PERMUTATION" ? [...numberValue].sort().join("") : numberValue;
}

/** คีย์เดียวกับ dedupeKey ใน validation.ts */
export function entryKey(prizeTypeId: string, numberValue: string, matchRule: MatchRuleName): string {
  return `${prizeTypeId}:${normalizedNumber(numberValue, matchRule)}`;
}

/**
 * เลขกลับทุกแบบที่ไม่ซ้ำกัน เรียงตามลำดับที่เกิด เช่น 483 → 483, 438, 843, 834, 348, 384
 * เลขที่มีหลักซ้ำได้น้อยกว่า เช่น 112 → 3 แบบ (x3) ส่วน 123 → 6 แบบ (x6)
 */
export function permutations(numberValue: string): string[] {
  const digits = [...numberValue];
  if (digits.length <= 1) return [numberValue];
  const seen = new Set<string>();
  const result: string[] = [];
  digits.forEach((digit, index) => {
    const rest = [...digits.slice(0, index), ...digits.slice(index + 1)].join("");
    for (const tail of permutations(rest)) {
      const candidate = digit + tail;
      if (!seen.has(candidate)) {
        seen.add(candidate);
        result.push(candidate);
      }
    }
  });
  return result;
}

/**
 * เพิ่มรายการเข้าโพย ถ้าเลขกับประเภทเดียวกันมีอยู่แล้วให้รวมยอดแทนการเพิ่มแถวซ้ำ
 * เพราะฝั่ง server ปฏิเสธรายการซ้ำในบิลเดียวกัน
 */
export function addEntries(
  current: readonly BetEntry[],
  additions: readonly BetEntry[],
  prizeTypes: ReadonlyMap<string, BetPrizeType>,
): BetEntry[] {
  const next = current.map((entry) => ({ ...entry }));
  for (const addition of additions) {
    const rule = prizeTypes.get(addition.prizeTypeId);
    if (!rule) continue;

    // รายการ "สลับ" เป็นตัวช่วยแตกเลข จึงไม่สร้างเลขเดิมซ้ำกับรายการตรงตัว
    // หากผู้ใช้เพิ่มรายการตรงตัวภายหลัง ให้รายการตรงตัวเป็นตัวหลักแทนรายการสลับ
    if (SWAP_PRIZE_CODES.has(rule.code)) {
      const hasPreferredExactEntry = next.some((entry) => {
        const existingRule = prizeTypes.get(entry.prizeTypeId);
        return (
          entry.number === addition.number &&
          existingRule?.matchRule === "EXACT" &&
          !SWAP_PRIZE_CODES.has(existingRule.code)
        );
      });
      if (hasPreferredExactEntry) continue;
    } else if (rule.matchRule === "EXACT") {
      for (let index = next.length - 1; index >= 0; index -= 1) {
        const existing = next[index];
        if (!existing || existing.number !== addition.number) continue;
        const existingRule = prizeTypes.get(existing.prizeTypeId);
        if (existingRule && SWAP_PRIZE_CODES.has(existingRule.code)) next.splice(index, 1);
      }
    }

    const key = entryKey(addition.prizeTypeId, addition.number, rule.matchRule);
    const existing = next.find((entry) => entryKey(entry.prizeTypeId, entry.number, rule.matchRule) === key);
    if (existing) existing.stake = Math.min(existing.stake + addition.stake, MAX_STAKE_PER_ITEM);
    else next.push({ ...addition });
  }
  return next;
}

/** สร้างรายการจากเลขที่กดครบหลัก ตามตัวเลือกที่เลือกไว้ และโหมดสลับเลข */
export function buildEntries(input: {
  numberValue: string;
  stake: number;
  selected: readonly BetPrizeType[];
  reverse: boolean;
}): BetEntry[] {
  const entries: BetEntry[] = [];
  const preferredExactNumbers = new Set(
    input.selected
      .filter(
        (prizeType) =>
          prizeType.matchRule === "EXACT" &&
          !SWAP_PRIZE_CODES.has(prizeType.code) &&
          input.numberValue.length === prizeType.digits,
      )
      .map(() => input.numberValue),
  );
  for (const prizeType of input.selected) {
    if (input.numberValue.length !== prizeType.digits) continue;
    // ประเภท "สลับ" ต้องแสดงและคิดยอดทุก permutation เป็นคนละรายการ
    // ส่วนรางวัลโต๊ดครอบคลุมทุกการสลับในรายการเดียว จึงไม่แตกเลข
    const numbers = SWAP_PRIZE_CODES.has(prizeType.code)
      ? permutations(input.numberValue)
      : input.reverse && prizeType.matchRule !== "PERMUTATION"
      ? permutations(input.numberValue)
      : [input.numberValue];
    for (const numberValue of numbers) {
      if (SWAP_PRIZE_CODES.has(prizeType.code) && preferredExactNumbers.has(numberValue)) continue;
      entries.push({ prizeTypeId: prizeType.id, number: numberValue, stake: input.stake });
    }
  }
  return entries;
}

/** จัดกลุ่มแท็บ: 2 ตัว, 3 ตัว, เลขวิ่ง, 4 ตัว และกลุ่มหลักอื่นที่มีใน Rulebook */
export function groupPrizeTypes(prizeTypes: readonly BetPrizeType[]): BetGroup[] {
  // รหัส 10/11 เคยถูกเก็บเป็นประเภทรางวัล "สลับ" แต่ในหน้าขายจริง
  // สลับเป็นเพียงปุ่มช่วยแตกเลขให้ประเภทที่เลือก (เช่น บน/ล่าง) ไม่ใช่รางวัลอีกประเภทหนึ่ง
  const selectablePrizeTypes = prizeTypes.filter((prizeType) => !SWAP_PRIZE_CODES.has(prizeType.code));
  const running = selectablePrizeTypes.filter((prizeType) => prizeType.matchRule === "CONTAINS_DIGIT");
  const byDigits = new Map<number, BetPrizeType[]>();
  for (const prizeType of selectablePrizeTypes) {
    if (prizeType.matchRule === "CONTAINS_DIGIT") continue;
    byDigits.set(prizeType.digits, [...(byDigits.get(prizeType.digits) ?? []), prizeType]);
  }

  const digitGroups = [...byDigits.entries()]
    .sort(([left], [right]) => left - right)
    .map(([digits, items]) => ({
      key: `d${digits}`,
      label: `${digits} ตัว`,
      digits,
      prizeTypes: [...items].sort((a, b) => a.code - b.code),
    }));

  const groups: BetGroup[] = [];
  for (const group of digitGroups) {
    groups.push(group);
    // เลขวิ่งอยู่ถัดจาก 3 ตัว ตามลำดับที่ผู้ใช้คุ้นเคย
    if (group.digits === 3 && running.length > 0) {
      groups.push({ key: "run", label: "เลขวิ่ง", digits: 1, prizeTypes: [...running].sort((a, b) => a.code - b.code) });
    }
  }
  if (running.length > 0 && !groups.some((group) => group.key === "run")) {
    groups.push({ key: "run", label: "เลขวิ่ง", digits: 1, prizeTypes: [...running].sort((a, b) => a.code - b.code) });
  }
  return groups;
}

// ---------------------------------------------------------------- สถานะโพย

export type BetStatus = "DRAFT" | "PENDING" | "WON" | "LOST" | "CANCELLED";

export const BET_STATUS_LABEL: Record<BetStatus, string> = {
  DRAFT: "ร่าง",
  PENDING: "กำลังแทง",
  WON: "ถูกรางวัล",
  LOST: "ไม่ถูกรางวัล",
  CANCELLED: "ลบแล้ว",
};

type BillStatusName = "DRAFT" | "CONFIRMED" | "LOCKED" | "SETTLED" | "CANCELLED";

/**
 * สถานะโพยที่ Agent เห็น คำนวณจากสถานะบิลและยอดจ่าย ไม่ได้เก็บแยก
 * บิลที่คำนวณผลแล้ว (SETTLED) และมียอดจ่ายมากกว่า 0 แปลว่ามีอย่างน้อยหนึ่งรายการถูกรางวัล
 */
export function betStatusOf(bill: { status: BillStatusName; totalPayout: { toString(): string } | number | string }): BetStatus {
  switch (bill.status) {
    case "DRAFT":
      return "DRAFT";
    case "CANCELLED":
      return "CANCELLED";
    case "SETTLED":
      return Number(bill.totalPayout.toString()) > 0 ? "WON" : "LOST";
    default:
      return "PENDING";
  }
}

/** สถานะของเลขแต่ละรายการในโพย */
export function itemBetStatus(billStatus: BillStatusName, isWinner: boolean): BetStatus {
  if (billStatus === "CANCELLED") return "CANCELLED";
  if (billStatus === "DRAFT") return "DRAFT";
  if (billStatus === "SETTLED") return isWinner ? "WON" : "LOST";
  return "PENDING";
}

export const BET_TABS = ["ALL", "PENDING", "WON", "LOST", "CANCELLED"] as const;
export type BetTab = (typeof BET_TABS)[number];

export function readBetTab(raw: string | undefined): BetTab {
  return BET_TABS.includes(raw as BetTab) ? (raw as BetTab) : "ALL";
}

// ---------------------------------------------------------------- ประเภทหวย

export const LOTTERY_TYPE_LABEL: Record<string, string> = {
  THAI_GOVERNMENT: "หวยรัฐบาล",
};

export function lotteryLabel(lotteryType: string): string {
  return LOTTERY_TYPE_LABEL[lotteryType] ?? lotteryType;
}

/** วันที่งวดแบบ 01/11/2026 ถ้างวดเก่าไม่มี drawDate ให้ใช้ชื่องวดแทน */
export function drawDateLabel(draw: { drawDate: Date | null; name: string }): string {
  // ผู้เรียกจะเติมคำว่า "งวด" นำหน้าเอง จึงตัดคำนี้ออกจากชื่อเดิมเพื่อไม่ให้ซ้ำ
  if (!draw.drawDate) return draw.name.replace(/^งวด\s*/, "") || draw.name;
  const day = String(draw.drawDate.getUTCDate()).padStart(2, "0");
  const month = String(draw.drawDate.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${draw.drawDate.getUTCFullYear()}`;
}

/** แสดงอัตราจ่ายแบบกระชับ เช่น 900.0000 → 900 และ 3.2000 → 3.2 */
export function compactRate(rate: { toString(): string } | string | number): string {
  const value = Number(rate.toString());
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}
