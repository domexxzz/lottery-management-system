-- Add a draw-local atomic counter and the user-visible sequence.
ALTER TABLE "draws" ADD COLUMN "billSequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "bills" ADD COLUMN "drawSequence" INTEGER;

-- Keep historical bills in their existing order. Drafts intentionally remain NULL.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "drawId"
      ORDER BY COALESCE("confirmedAt", "createdAt"), "createdAt", "id"
    )::INTEGER AS sequence
  FROM "bills"
  WHERE "status" <> 'DRAFT'
)
UPDATE "bills" AS bill
SET "drawSequence" = ranked.sequence
FROM ranked
WHERE bill."id" = ranked."id";

UPDATE "draws" AS draw
SET "billSequence" = sequences.maximum
FROM (
  SELECT "drawId", MAX("drawSequence") AS maximum
  FROM "bills"
  WHERE "drawSequence" IS NOT NULL
  GROUP BY "drawId"
) AS sequences
WHERE draw."id" = sequences."drawId";

CREATE UNIQUE INDEX "bills_drawId_drawSequence_key" ON "bills"("drawId", "drawSequence");
