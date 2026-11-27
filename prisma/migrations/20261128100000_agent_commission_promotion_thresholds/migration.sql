ALTER TABLE "agents" DROP CONSTRAINT "agents_commission_promotion_all_or_none";
ALTER TABLE "agents" DROP CONSTRAINT "agents_commission_promotion_valid";

ALTER TABLE "agents"
ADD COLUMN "commissionPromotionThaiMinGross" DECIMAL(18,2),
ADD COLUMN "commissionPromotionLaoMinGross" DECIMAL(18,2);

-- Existing promotions keep the same threshold for both lottery families.
UPDATE "agents"
SET "commissionPromotionThaiMinGross" = "commissionPromotionMinGross",
    "commissionPromotionLaoMinGross" = "commissionPromotionMinGross"
WHERE "commissionPromotionMinGross" IS NOT NULL;

ALTER TABLE "agents" DROP COLUMN "commissionPromotionMinGross";

ALTER TABLE "agents"
ADD CONSTRAINT "agents_commission_promotion_all_or_none" CHECK (
  ("commissionPromotionStartsOn" IS NULL
    AND "commissionPromotionEndsOn" IS NULL
    AND "commissionPromotionThaiMinGross" IS NULL
    AND "commissionPromotionLaoMinGross" IS NULL
    AND "commissionPromotionThaiRate" IS NULL
    AND "commissionPromotionLaoRate" IS NULL)
  OR
  ("commissionPromotionStartsOn" IS NOT NULL
    AND "commissionPromotionEndsOn" IS NOT NULL
    AND ("commissionPromotionThaiMinGross" IS NOT NULL OR "commissionPromotionLaoMinGross" IS NOT NULL)
    AND ("commissionPromotionThaiMinGross" IS NULL) = ("commissionPromotionThaiRate" IS NULL)
    AND ("commissionPromotionLaoMinGross" IS NULL) = ("commissionPromotionLaoRate" IS NULL))
);

ALTER TABLE "agents"
ADD CONSTRAINT "agents_commission_promotion_valid" CHECK (
  "commissionPromotionStartsOn" IS NULL
  OR (
    "commissionPromotionStartsOn" <= "commissionPromotionEndsOn"
    AND ("commissionPromotionThaiMinGross" IS NULL OR "commissionPromotionThaiMinGross" > 0)
    AND ("commissionPromotionLaoMinGross" IS NULL OR "commissionPromotionLaoMinGross" > 0)
    AND ("commissionPromotionThaiRate" IS NULL OR "commissionPromotionThaiRate" BETWEEN 0 AND 100)
    AND ("commissionPromotionLaoRate" IS NULL OR "commissionPromotionLaoRate" BETWEEN 0 AND 100)
  )
);
