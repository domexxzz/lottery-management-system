import { Prisma } from "@prisma/client";
import { databaseSchema } from "@/lib/db";

/**
 * ยอดรับต่อเลข (Number exposure) คำนวณด้วย SQL aggregation ในฐานข้อมูล
 *
 * แหล่งความจริงเดียวของ "เลขนี้รับไปแล้วเท่าไร" ใช้ทั้งตอนตรวจบิลก่อนบันทึก
 * หน้าประกาศ แดชบอร์ด และหน้ารายการเลขเต็ม จึงไม่มีทางที่สองที่นับไม่ตรงกัน
 *
 * - นับเฉพาะบิลที่มีผลผูกพัน (CONFIRMED, LOCKED, SETTLED) บิลร่างและบิลยกเลิกไม่นับ
 *   ยกเลิกบิลเมื่อไร ยอดของเลขลดลงทันทีในการอ่านครั้งถัดไป
 * - หนึ่งแถวต่อ "ประเภทรางวัล + เลข" รายการแต่ละรายการถูกรวมครั้งเดียวผ่าน GROUP BY
 * - รางวัลโต๊ด (PERMUTATION) เรียงหลักก่อนรวม 123 กับ 321 จึงเป็นเลขเดียวกัน
 *   ตรงกับ dedupeKey ฝั่งตรวจบิล
 */

/** เริ่มเตือนเมื่อใช้วงเงินแล้ว 80% (เหลือรับได้ไม่เกิน 20%) */
export const NEAR_FULL_RATIO = 0.8;
export const COMMITTED_BILL_STATUSES = ["CONFIRMED", "LOCKED", "SETTLED"] as const;

export type ExposureStatus = "normal" | "near" | "full";
export type ExposureSort = "used" | "remaining" | "percent" | "number";

export type ExposureRow = {
  prizeTypeId: string;
  prizeTypeName: string;
  prizeTypeCode: number;
  /** เลขที่รวมยอดแล้ว รางวัลโต๊ดเป็นเลขที่เรียงหลักแล้ว */
  number: string;
  isPermutation: boolean;
  used: Prisma.Decimal;
  itemCount: number;
  /** null เมื่องวดไม่จำกัดเพดาน */
  remaining: Prisma.Decimal | null;
  percent: number | null;
  status: ExposureStatus;
};

export type ExposureSummary = {
  total: number;
  normal: number;
  near: number;
  full: number;
  totalStake: Prisma.Decimal;
};

type SqlClient = Pick<Prisma.TransactionClient, "$queryRaw">;

function table(name: "bills" | "bill_items" | "prize_types") {
  const schema = databaseSchema().replaceAll('"', '""');
  return Prisma.raw(`"${schema}"."${name}"`);
}

export type ExposureScope = {
  drawId: string;
  cap: Prisma.Decimal | null;
  organizationId?: string;
  /** ไม่นับบิลใบนี้ ใช้ตอนตรวจบิลที่กำลังยืนยันหรือแก้ไข */
  excludeBillId?: string;
  /** นับเฉพาะประเภทรางวัลเหล่านี้ */
  prizeTypeIds?: readonly string[];
};

/** CTE "exposure" หนึ่งแถวต่อประเภทรางวัล + เลข พร้อมสถานะเทียบเพดาน */
function exposureCte(scope: ExposureScope): Prisma.Sql {
  const cap = scope.cap === null ? null : scope.cap.toFixed(2);
  return Prisma.sql`
    WITH agg AS (
      SELECT bi."prizeTypeId" AS prize_type_id,
             CASE WHEN pt."matchRule" = 'PERMUTATION'
                  THEN array_to_string(ARRAY(SELECT d FROM unnest(string_to_array(bi.number, NULL)) AS d ORDER BY d), '')
                  ELSE bi.number END AS num,
             SUM(bi.stake) AS used,
             COUNT(*)::int AS item_count
      FROM ${table("bill_items")} bi
      JOIN ${table("bills")} b ON b.id = bi."billId"
      JOIN ${table("prize_types")} pt ON pt.id = bi."prizeTypeId"
      WHERE b."drawId" = ${scope.drawId}
        AND b."status" IN ('CONFIRMED', 'LOCKED', 'SETTLED')
        ${scope.organizationId ? Prisma.sql`AND b."organizationId" = ${scope.organizationId}` : Prisma.empty}
        ${scope.excludeBillId ? Prisma.sql`AND b.id <> ${scope.excludeBillId}` : Prisma.empty}
        ${scope.prizeTypeIds ? (scope.prizeTypeIds.length === 0 ? Prisma.sql`AND FALSE` : Prisma.sql`AND bi."prizeTypeId" IN (${Prisma.join(scope.prizeTypeIds)})`) : Prisma.empty}
      GROUP BY 1, 2
    ),
    exposure AS (
      SELECT a.prize_type_id, a.num, a.used, a.item_count,
             pt.name AS prize_type_name, pt.code AS prize_type_code,
             (pt."matchRule" = 'PERMUTATION') AS is_perm,
             (${cap}::numeric - a.used) AS remaining,
             ROUND(a.used * 100 / NULLIF(${cap}::numeric, 0), 2) AS percent,
             CASE
               WHEN ${cap}::numeric IS NULL THEN 'normal'
               WHEN a.used >= ${cap}::numeric THEN 'full'
               WHEN a.used >= ${cap}::numeric * ${NEAR_FULL_RATIO} THEN 'near'
               ELSE 'normal'
             END AS status
      FROM agg a
      JOIN ${table("prize_types")} pt ON pt.id = a.prize_type_id
    )
  `;
}

type RawRow = {
  prize_type_id: string;
  num: string;
  used: Prisma.Decimal;
  item_count: number;
  prize_type_name: string;
  prize_type_code: number;
  is_perm: boolean;
  remaining: Prisma.Decimal | null;
  percent: Prisma.Decimal | null;
  status: ExposureStatus;
  total_count?: bigint;
};

function toRow(row: RawRow): ExposureRow {
  return {
    prizeTypeId: row.prize_type_id,
    prizeTypeName: row.prize_type_name,
    prizeTypeCode: row.prize_type_code,
    number: row.num,
    isPermutation: row.is_perm,
    used: new Prisma.Decimal(row.used),
    itemCount: row.item_count,
    remaining: row.remaining === null ? null : new Prisma.Decimal(row.remaining),
    percent: row.percent === null ? null : Number(row.percent),
    status: row.status,
  };
}

/** สรุปจำนวนเลขแยกสถานะ */
export async function exposureSummary(client: SqlClient, scope: ExposureScope): Promise<ExposureSummary> {
  const [row] = await client.$queryRaw<{ total: number; normal: number; near: number; full: number; total_stake: Prisma.Decimal | null }[]>(Prisma.sql`
    ${exposureCte(scope)}
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'normal')::int AS normal,
           COUNT(*) FILTER (WHERE status = 'near')::int AS near,
           COUNT(*) FILTER (WHERE status = 'full')::int AS full,
           SUM(used) AS total_stake
    FROM exposure
  `);
  return {
    total: row?.total ?? 0,
    normal: row?.normal ?? 0,
    near: row?.near ?? 0,
    full: row?.full ?? 0,
    totalStake: new Prisma.Decimal(row?.total_stake ?? 0),
  };
}

export type ExposureQuery = {
  status?: ExposureStatus | "all";
  prizeTypeId?: string;
  /** ค้นหาเลข พิมพ์บางส่วนได้ รางวัลโต๊ดค้นด้วยเลขสลับหลักก็เจอ */
  search?: string;
  sort?: ExposureSort;
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

const SORT_SQL: Record<ExposureSort, string> = {
  used: "used",
  remaining: "remaining",
  percent: "percent",
  number: "num",
};

/** รายการเลขแบบแบ่งหน้า กรอง ค้นหา และเรียงในฐานข้อมูล */
export async function listExposure(
  client: SqlClient,
  scope: ExposureScope,
  query: ExposureQuery = {},
): Promise<{ rows: ExposureRow[]; total: number; page: number; pageSize: number; pageCount: number }> {
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 200);
  const requestedPage = Math.max(Math.floor(query.page ?? 1), 1);
  const search = (query.search ?? "").replace(/\D/g, "").slice(0, 6);
  const sortedSearch = [...search].sort().join("");
  const sort = SORT_SQL[query.sort ?? "percent"];
  const direction = query.direction === "asc" ? "ASC" : "DESC";

  const where = Prisma.sql`
    WHERE TRUE
      ${query.status && query.status !== "all" ? Prisma.sql`AND status = ${query.status}` : Prisma.empty}
      ${query.prizeTypeId ? Prisma.sql`AND prize_type_id = ${query.prizeTypeId}` : Prisma.empty}
      ${search ? Prisma.sql`AND (num LIKE ${`%${search}%`} OR (is_perm AND num = ${sortedSearch}))` : Prisma.empty}
  `;
  const order = Prisma.raw(`${sort} ${direction} NULLS LAST, used DESC, prize_type_code ASC, num ASC`);

  const run = (page: number) => client.$queryRaw<RawRow[]>(Prisma.sql`
    ${exposureCte(scope)}
    SELECT *, COUNT(*) OVER () AS total_count
    FROM exposure
    ${where}
    ORDER BY ${order}
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `);

  let page = requestedPage;
  let raw = await run(page);
  let total = Number(raw[0]?.total_count ?? 0);
  // เปิดหน้าที่เกินจำนวนจริง (เช่น ข้อมูลลดลงหลังยกเลิกบิล) ให้ไปหน้าสุดท้ายแทนหน้าว่าง
  if (raw.length === 0 && page > 1) {
    const [countRow] = await client.$queryRaw<{ total: number }[]>(Prisma.sql`
      ${exposureCte(scope)}
      SELECT COUNT(*)::int AS total FROM exposure ${where}
    `);
    total = countRow?.total ?? 0;
    if (total > 0) {
      page = Math.ceil(total / pageSize);
      raw = await run(page);
    }
  }
  return {
    rows: raw.map(toRow),
    total,
    page,
    pageSize,
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
  };
}

/** ยอดรวมทุกเลขแบบ map คีย์ตาม dedupeKey ("prizeTypeId:เลข") ใช้ตอนตรวจบิล */
export async function exposureMap(client: SqlClient, scope: ExposureScope): Promise<Map<string, Prisma.Decimal>> {
  const raw = await client.$queryRaw<{ prize_type_id: string; num: string; used: Prisma.Decimal }[]>(Prisma.sql`
    ${exposureCte(scope)}
    SELECT prize_type_id, num, used FROM exposure
  `);
  return new Map(raw.map((row) => [`${row.prize_type_id}:${row.num}`, new Prisma.Decimal(row.used)]));
}

/** เลขทุกตัวในสถานะที่ระบุ ใช้กับรายการที่ต้องครบ เช่น เลขเต็มที่หน้าแทงต้องบล็อก */
export async function exposureByStatus(
  client: SqlClient,
  scope: ExposureScope,
  status: ExposureStatus,
  limit?: number,
): Promise<ExposureRow[]> {
  const raw = await client.$queryRaw<RawRow[]>(Prisma.sql`
    ${exposureCte(scope)}
    SELECT * FROM exposure
    WHERE status = ${status}
    ORDER BY remaining ASC NULLS LAST, prize_type_code ASC, num ASC
    ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}
  `);
  return raw.map(toRow);
}
