ALTER TABLE "results"
ADD COLUMN "values" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "results"
SET "values" = ARRAY["value"]
WHERE cardinality("values") = 0;
