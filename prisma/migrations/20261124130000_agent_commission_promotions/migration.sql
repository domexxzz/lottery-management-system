ALTER TABLE "agents"
ADD COLUMN "commissionPromotionStartsOn" DATE,
ADD COLUMN "commissionPromotionEndsOn" DATE,
ADD COLUMN "commissionPromotionMinGross" DECIMAL(18,2),
ADD COLUMN "commissionPromotionThaiRate" DECIMAL(7,4),
ADD COLUMN "commissionPromotionLaoRate" DECIMAL(7,4);

ALTER TABLE "agents"
ADD CONSTRAINT "agents_commission_promotion_all_or_none" CHECK (
  ("commissionPromotionStartsOn" IS NULL
    AND "commissionPromotionEndsOn" IS NULL
    AND "commissionPromotionMinGross" IS NULL
    AND "commissionPromotionThaiRate" IS NULL
    AND "commissionPromotionLaoRate" IS NULL)
  OR
  ("commissionPromotionStartsOn" IS NOT NULL
    AND "commissionPromotionEndsOn" IS NOT NULL
    AND "commissionPromotionMinGross" IS NOT NULL
    AND "commissionPromotionThaiRate" IS NOT NULL
    AND "commissionPromotionLaoRate" IS NOT NULL)
);

ALTER TABLE "agents"
ADD CONSTRAINT "agents_commission_promotion_valid" CHECK (
  "commissionPromotionStartsOn" IS NULL
  OR (
    "commissionPromotionStartsOn" <= "commissionPromotionEndsOn"
    AND "commissionPromotionMinGross" > 0
    AND "commissionPromotionThaiRate" BETWEEN 0 AND 100
    AND "commissionPromotionLaoRate" BETWEEN 0 AND 100
  )
);
