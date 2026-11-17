-- ประเภทรางวัลหวยลาว (101–104) และหวยลาวชุด (201–207) ให้ทุกองค์กร
-- อัตราจ่ายตามที่ Owner กำหนด แก้ได้ภายหลังในหน้า Rulebook
INSERT INTO "prize_types" ("id", "organizationId", "code", "name", "digits", "matchRule", "lotteryType", "payoutRate", "isActive", "createdAt", "updatedAt")
SELECT
  'pt' || substr(md5(o.id || ':' || v.code::text || ':' || clock_timestamp()::text), 1, 23),
  o.id, v.code, v.name, v.digits, v.rule::"MatchRule", v.lottery::"LotteryType", v.rate, TRUE, NOW(), NOW()
FROM "organizations" o
CROSS JOIN (VALUES
  (101, '3 ตัวตรง',       3, 'EXACT',       'LAO',     650.0000),
  (102, '3 ตัวโต๊ด',      3, 'PERMUTATION', 'LAO',     100.0000),
  (103, '2 ตัวบน',        2, 'EXACT',       'LAO',      75.0000),
  (104, '2 ตัวล่าง',      2, 'EXACT',       'LAO',      75.0000),
  (201, '4 ตัวตรง',       4, 'EXACT',       'LAO_SET', 50000.0000),
  (202, '3 ตัวท้ายตรง',   3, 'EXACT',       'LAO_SET', 17000.0000),
  (203, '4 ตัวโต๊ด',      4, 'PERMUTATION', 'LAO_SET', 2000.0000),
  (204, '3 ตัวท้ายโต๊ด',  3, 'PERMUTATION', 'LAO_SET', 1250.0000),
  (205, '3 ตัวหน้าตรง',   3, 'EXACT',       'LAO_SET', 600.0000),
  (206, '2 ตัวหน้า',      2, 'EXACT',       'LAO_SET', 500.0000),
  (207, '2 ตัวหลัง',      2, 'EXACT',       'LAO_SET', 500.0000)
) AS v(code, name, digits, rule, lottery, rate)
ON CONFLICT ("organizationId", "code") DO NOTHING;
