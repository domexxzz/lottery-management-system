import { describe, expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { dedupeKey, totalStake, validateBill, type PrizeTypeRule } from "./validation";

const d = (v: string | number) => new Prisma.Decimal(v);

const THREE_TOP: PrizeTypeRule = {
  id: "pt-3top",
  code: 1,
  name: "3 ตัวบน",
  digits: 3,
  matchRule: "EXACT",
  payoutRate: d("900"),
  maxStakePerItem: d("5000"),
};

const THREE_TOD: PrizeTypeRule = {
  id: "pt-3tod",
  code: 2,
  name: "3 ตัวโต๊ด",
  digits: 3,
  matchRule: "PERMUTATION",
  payoutRate: d("150"),
  maxStakePerItem: null,
};

const RULES = new Map([
  [THREE_TOP.id, THREE_TOP],
  [THREE_TOD.id, THREE_TOD],
]);

const NOW = new Date("2026-11-03T10:00:00Z");
const OPEN_DRAW = { status: "OPEN", cutoffAt: new Date("2026-11-10T10:00:00Z") };

function run(overrides: {
  items?: { prizeTypeId: string; number: string; stake: Prisma.Decimal }[];
  creditLimit?: Prisma.Decimal | null;
  perNumberLimit?: Prisma.Decimal | null;
  draw?: { status: string; cutoffAt: Date };
  existing?: Prisma.Decimal;
  now?: Date;
}) {
  return validateBill({
    items: overrides.items ?? [{ prizeTypeId: THREE_TOP.id, number: "123", stake: d("100") }],
    rules: RULES,
    agent: {
      creditLimit: overrides.creditLimit === undefined ? null : overrides.creditLimit,
      perNumberLimit: overrides.perNumberLimit === undefined ? null : overrides.perNumberLimit,
    },
    draw: overrides.draw ?? OPEN_DRAW,
    existingStakeInDraw: overrides.existing ?? d(0),
    now: overrides.now ?? NOW,
  });
}

const codes = (issues: ReturnType<typeof validateBill>) => issues.map((i) => i.code);

describe("รูปแบบเลข", () => {
  test("ผ่านเมื่อเลขเป็นตัวเลขและยาวตรงกับจำนวนหลักของรางวัล", () => {
    expect(run({})).toEqual([]);
  });

  test("ปฏิเสธเลขที่มีตัวอักษรปน", () => {
    const issues = run({ items: [{ prizeTypeId: THREE_TOP.id, number: "12a", stake: d("100") }] });
    expect(codes(issues)).toContain("NUMBER_NOT_NUMERIC");
  });

  test("ปฏิเสธเลขสั้นกว่าจำนวนหลักที่กำหนด", () => {
    const issues = run({ items: [{ prizeTypeId: THREE_TOP.id, number: "12", stake: d("100") }] });
    expect(codes(issues)).toContain("NUMBER_WRONG_LENGTH");
  });

  test("ปฏิเสธเลขยาวกว่าจำนวนหลักที่กำหนด", () => {
    const issues = run({ items: [{ prizeTypeId: THREE_TOP.id, number: "1234", stake: d("100") }] });
    expect(codes(issues)).toContain("NUMBER_WRONG_LENGTH");
  });

  test("ยอมรับเลขศูนย์นำหน้าเพราะเก็บเป็น string", () => {
    expect(run({ items: [{ prizeTypeId: THREE_TOP.id, number: "007", stake: d("100") }] })).toEqual(
      [],
    );
  });

  test("ปฏิเสธประเภทรางวัลที่ไม่รู้จัก", () => {
    const issues = run({ items: [{ prizeTypeId: "ไม่มีจริง", number: "123", stake: d("100") }] });
    expect(codes(issues)).toContain("UNKNOWN_PRIZE_TYPE");
  });
});

describe("ยอดเดิมพัน", () => {
  test("ปฏิเสธยอดเป็นศูนย์", () => {
    const issues = run({ items: [{ prizeTypeId: THREE_TOP.id, number: "123", stake: d("0") }] });
    expect(codes(issues)).toContain("STAKE_NOT_POSITIVE");
  });

  test("ปฏิเสธยอดติดลบ", () => {
    const issues = run({ items: [{ prizeTypeId: THREE_TOP.id, number: "123", stake: d("-50") }] });
    expect(codes(issues)).toContain("STAKE_NOT_POSITIVE");
  });

  test("ปฏิเสธยอดเกินวงเงินต่อรายการของประเภทรางวัล", () => {
    const issues = run({
      items: [{ prizeTypeId: THREE_TOP.id, number: "123", stake: d("5000.01") }],
    });
    expect(codes(issues)).toContain("STAKE_OVER_ITEM_LIMIT");
  });

  test("ยอมรับยอดที่เท่ากับวงเงินพอดี", () => {
    expect(
      run({ items: [{ prizeTypeId: THREE_TOP.id, number: "123", stake: d("5000") }] }),
    ).toEqual([]);
  });
});

describe("รายการซ้ำ", () => {
  test("ตรวจพบเลขซ้ำในประเภทรางวัลเดียวกัน", () => {
    const issues = run({
      items: [
        { prizeTypeId: THREE_TOP.id, number: "123", stake: d("100") },
        { prizeTypeId: THREE_TOP.id, number: "123", stake: d("50") },
      ],
    });
    expect(codes(issues)).toContain("DUPLICATE_ITEM");
  });

  test("เลขเดียวกันคนละประเภทรางวัลไม่ถือว่าซ้ำ", () => {
    expect(
      run({
        items: [
          { prizeTypeId: THREE_TOP.id, number: "123", stake: d("100") },
          { prizeTypeId: THREE_TOD.id, number: "123", stake: d("100") },
        ],
      }),
    ).toEqual([]);
  });

  test("รางวัลโต๊ด: 123 กับ 321 ถือว่าซ้ำกัน", () => {
    const issues = run({
      items: [
        { prizeTypeId: THREE_TOD.id, number: "123", stake: d("100") },
        { prizeTypeId: THREE_TOD.id, number: "321", stake: d("100") },
      ],
    });
    expect(codes(issues)).toContain("DUPLICATE_ITEM");
  });

  test("รางวัลไม่ใช่โต๊ด: 123 กับ 321 เป็นคนละเลข", () => {
    expect(
      run({
        items: [
          { prizeTypeId: THREE_TOP.id, number: "123", stake: d("100") },
          { prizeTypeId: THREE_TOP.id, number: "321", stake: d("100") },
        ],
      }),
    ).toEqual([]);
  });

  test("dedupeKey เรียงหลักเฉพาะรางวัลโต๊ด", () => {
    expect(dedupeKey("p", "321", "PERMUTATION")).toBe(dedupeKey("p", "123", "PERMUTATION"));
    expect(dedupeKey("p", "321", "EXACT")).not.toBe(dedupeKey("p", "123", "EXACT"));
  });
});

describe("วงเงิน Agent", () => {
  test("ปฏิเสธเมื่อยอดรวมต่อเลขเกินวงเงินต่อเลข", () => {
    const issues = run({
      items: [
        { prizeTypeId: THREE_TOP.id, number: "123", stake: d("600") },
        { prizeTypeId: THREE_TOD.id, number: "999", stake: d("100") },
      ],
      perNumberLimit: d("500"),
    });
    expect(codes(issues)).toContain("OVER_PER_NUMBER_LIMIT");
  });

  test("วงเงินต่อเลขนับรวมหลายรายการของเลขเดียวกัน", () => {
    const issues = run({
      items: [
        { prizeTypeId: THREE_TOD.id, number: "123", stake: d("300") },
        { prizeTypeId: THREE_TOD.id, number: "321", stake: d("300") },
      ],
      perNumberLimit: d("500"),
    });
    // ซ้ำกันเพราะเป็นโต๊ด และรวมกันแล้ว 600 เกิน 500
    expect(codes(issues)).toContain("DUPLICATE_ITEM");
    expect(codes(issues)).toContain("OVER_PER_NUMBER_LIMIT");
  });

  test("ปฏิเสธเมื่อยอดรวมทั้งรอบเกินวงเงิน", () => {
    const issues = run({
      items: [{ prizeTypeId: THREE_TOP.id, number: "123", stake: d("400") }],
      creditLimit: d("1000"),
      existing: d("700"),
    });
    expect(codes(issues)).toContain("OVER_CREDIT_LIMIT");
  });

  test("ยอมรับเมื่อยอดรวมเท่ากับวงเงินพอดี", () => {
    expect(
      run({
        items: [{ prizeTypeId: THREE_TOP.id, number: "123", stake: d("300") }],
        creditLimit: d("1000"),
        existing: d("700"),
      }),
    ).toEqual([]);
  });

  test("ไม่จำกัดวงเงินเมื่อค่าเป็น null", () => {
    expect(
      run({
        items: [{ prizeTypeId: THREE_TOD.id, number: "123", stake: d("999999") }],
        creditLimit: null,
        perNumberLimit: null,
      }),
    ).toEqual([]);
  });
});

describe("เวลาปิดรับ", () => {
  test("ปฏิเสธเมื่อรอบไม่ได้อยู่ในสถานะเปิดรับ", () => {
    const issues = run({ draw: { status: "LOCKED", cutoffAt: OPEN_DRAW.cutoffAt } });
    expect(codes(issues)).toContain("DRAW_NOT_OPEN");
  });

  test("ปฏิเสธเมื่อเลยเวลา Cutoff แล้ว", () => {
    const issues = run({ now: new Date("2026-11-10T10:00:01Z") });
    expect(codes(issues)).toContain("PAST_CUTOFF");
  });

  test("ปฏิเสธเมื่อถึงเวลา Cutoff พอดี", () => {
    const issues = run({ now: new Date("2026-11-10T10:00:00Z") });
    expect(codes(issues)).toContain("PAST_CUTOFF");
  });

  test("ยอมรับหนึ่งมิลลิวินาทีก่อน Cutoff", () => {
    expect(run({ now: new Date("2026-11-10T09:59:59.999Z") })).toEqual([]);
  });
});

describe("บิลว่าง", () => {
  test("ปฏิเสธบิลที่ไม่มีรายการ", () => {
    expect(codes(run({ items: [] }))).toContain("EMPTY_BILL");
  });
});

describe("totalStake", () => {
  test("บวกยอดแบบ Decimal ไม่เพี้ยนเหมือน float", () => {
    const sum = totalStake([
      { prizeTypeId: THREE_TOP.id, number: "123", stake: d("0.1") },
      { prizeTypeId: THREE_TOP.id, number: "456", stake: d("0.2") },
    ]);
    expect(sum.toFixed(2)).toBe("0.30");
    // 0.1 + 0.2 ด้วย float จะได้ 0.30000000000000004
    expect(sum.equals(d("0.3"))).toBe(true);
  });

  test("บิลว่างได้ศูนย์", () => {
    expect(totalStake([]).toFixed(2)).toBe("0.00");
  });
});

describe("เลขเต็มและเลขอั้น", () => {
  const restricted = (kind: "CLOSED" | "REDUCED_RATE") =>
    new Map([[dedupeKey(THREE_TOD.id, "123", "PERMUTATION"), { kind, payoutRate: kind === "CLOSED" ? null : d("100") }]]);

  function runWith(restrictions: ReturnType<typeof restricted>, numberValue: string) {
    return validateBill({
      items: [{ prizeTypeId: THREE_TOD.id, number: numberValue, stake: d("10") }],
      rules: RULES,
      agent: { creditLimit: null, perNumberLimit: null },
      draw: OPEN_DRAW,
      existingStakeInDraw: d(0),
      now: NOW,
      restrictions,
    });
  }

  test("ปฏิเสธเลขเต็ม รวมถึงเลขสลับหลักของรางวัลโต๊ด", () => {
    expect(codes(runWith(restricted("CLOSED"), "123"))).toContain("NUMBER_CLOSED");
    expect(codes(runWith(restricted("CLOSED"), "321"))).toContain("NUMBER_CLOSED");
  });

  test("เลขอั้นยังรับได้ อัตราจ่ายลดลงถูกจัดการตอน snapshot", () => {
    expect(runWith(restricted("REDUCED_RATE"), "123")).toEqual([]);
  });

  test("เลขเต็มของประเภทหนึ่งไม่กระทบประเภทอื่น", () => {
    expect(run({ items: [{ prizeTypeId: THREE_TOP.id, number: "123", stake: d("10") }] })).toEqual([]);
  });
});
