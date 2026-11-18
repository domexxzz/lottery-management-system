-- Link only unambiguous legacy Lao/Lao Set pairs. Draws created separately stay independent.
ALTER TABLE "draws" ADD COLUMN "laoFamilyId" TEXT;

WITH pairable AS (
  SELECT
    "organizationId",
    "drawDate",
    "opensAt",
    "cutoffAt",
    "resultAt",
    'legacy-' || md5(
      "organizationId" || ':' ||
      "drawDate"::text || ':' ||
      "opensAt"::text || ':' ||
      "cutoffAt"::text || ':' ||
      coalesce("resultAt"::text, '')
    ) AS family_id
  FROM "draws"
  WHERE "drawDate" IS NOT NULL
    AND "lotteryType" IN ('LAO', 'LAO_SET')
  GROUP BY "organizationId", "drawDate", "opensAt", "cutoffAt", "resultAt"
  HAVING COUNT(*) = 2
    AND COUNT(*) FILTER (WHERE "lotteryType" = 'LAO') = 1
    AND COUNT(*) FILTER (WHERE "lotteryType" = 'LAO_SET') = 1
)
UPDATE "draws" AS draw
SET "laoFamilyId" = pairable.family_id
FROM pairable
WHERE draw."organizationId" = pairable."organizationId"
  AND draw."drawDate" = pairable."drawDate"
  AND draw."opensAt" = pairable."opensAt"
  AND draw."cutoffAt" = pairable."cutoffAt"
  AND draw."resultAt" IS NOT DISTINCT FROM pairable."resultAt"
  AND draw."lotteryType" IN ('LAO', 'LAO_SET');

CREATE INDEX "draws_organizationId_laoFamilyId_idx"
  ON "draws"("organizationId", "laoFamilyId");
