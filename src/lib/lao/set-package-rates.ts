/**
 * แหล่งข้อมูลกลางของราคาชุดและยอดจ่ายหวยลาวชุด
 * แยกจาก rules.ts เพื่อให้ Client Component รับค่าใหม่ครบถ้วนระหว่าง Fast Refresh
 */

export const LAO_SET_PACKAGE_PRICES = [30, 60, 120] as const;

export const LAO_SET_PACKAGE_PAYOUTS = [
  { price: 30, exact: 25_500, permutation: 1_125, last3Exact: 9_250, last3Permutation: 925, first3Exact: 1_425, first3Permutation: 425, first2: 350, last2: 350 },
  { price: 60, exact: 51_000, permutation: 2_250, last3Exact: 18_500, last3Permutation: 1_850, first3Exact: 2_850, first3Permutation: 850, first2: 700, last2: 700 },
  { price: 120, exact: 102_000, permutation: 4_500, last3Exact: 37_000, last3Permutation: 3_700, first3Exact: 5_700, first3Permutation: 1_700, first2: 1_400, last2: 1_400 },
] as const;

/** ลำดับคอลัมน์กลางสำหรับหน้ากติกาและ Rulebook เพื่อไม่ให้ชื่อหรือยอดจ่ายคลาดกัน */
export const LAO_SET_PAYOUT_COLUMNS = [
  { key: "exact", code: 201, label: "4 ตัวตรง" },
  { key: "permutation", code: 203, label: "4 ตัวโต๊ด" },
  { key: "last3Exact", code: 202, label: "3 ตัวหลังตรง" },
  { key: "last3Permutation", code: 204, label: "3 ตัวหลังโต๊ด" },
  { key: "first3Exact", code: 205, label: "3 ตัวหน้าตรง" },
  { key: "first3Permutation", code: 208, label: "3 ตัวหน้าโต๊ด" },
  { key: "first2", code: 206, label: "2 ตัวหน้า" },
  { key: "last2", code: 207, label: "2 ตัวหลัง" },
] as const;

export type LaoSetPayoutRow = {
  price: number;
  exact: number;
  permutation: number;
  last3Exact: number;
  last3Permutation: number;
  first3Exact: number;
  first3Permutation: number;
  first2: number;
  last2: number;
};

/** สร้างตารางยอดจ่ายจากอัตราต่อหน่วยในฐานข้อมูลสำหรับแสดงผล */
export function buildLaoSetPayoutRows(rateOf: (prizeTypeCode: number) => number): LaoSetPayoutRow[] {
  return LAO_SET_PACKAGE_PRICES.map((price) => {
    const row: Record<string, number> = { price };
    for (const column of LAO_SET_PAYOUT_COLUMNS) {
      row[column.key] = Math.round(rateOf(column.code) * price * 100) / 100;
    }
    return row as LaoSetPayoutRow;
  });
}

export type LaoSetPackagePrice = (typeof LAO_SET_PACKAGE_PRICES)[number];

export function laoSetPackagePrice(value: { toString(): string } | string | number): LaoSetPackagePrice | null {
  const price = Number(value.toString());
  return LAO_SET_PACKAGE_PRICES.find((allowed) => allowed === price) ?? null;
}

export function laoSetPackageLabel(value: { toString(): string } | string | number): string | null {
  const price = laoSetPackagePrice(value);
  return price === null ? null : `ชุด ${price} บาท`;
}
