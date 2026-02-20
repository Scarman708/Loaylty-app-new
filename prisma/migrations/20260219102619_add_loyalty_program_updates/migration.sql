-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "shopCustomerId" BIGINT NOT NULL,
    "email" TEXT,
    "acceptsMarketing" BOOLEAN DEFAULT false,
    "pointBalance" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "currentTierId" INTEGER,
    "lastActivityAt" DATETIME,
    "lastEarnedAt" DATETIME,
    "lastRedeemedAt" DATETIME,
    "lastReviewPointsAt" DATETIME,
    "welcomeBonusBronzeAwarded" BOOLEAN NOT NULL DEFAULT false,
    "welcomeBonusSilverAwarded" BOOLEAN NOT NULL DEFAULT false,
    "welcomeBonusGoldAwarded" BOOLEAN NOT NULL DEFAULT false,
    "birthday" DATETIME,
    "lastBirthdayPointsAt" DATETIME,
    "nextBirthdayPointsAt" DATETIME,
    "currentMonthReviewCount" INTEGER NOT NULL DEFAULT 0,
    "lastReviewMonth" INTEGER,
    "lastReviewYear" INTEGER,
    "referralCode" TEXT,
    "referredByCode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customer_referredByCode_fkey" FOREIGN KEY ("referredByCode") REFERENCES "Customer" ("referralCode") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Customer_currentTierId_fkey" FOREIGN KEY ("currentTierId") REFERENCES "Tier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Customer" ("acceptsMarketing", "birthday", "createdAt", "currentTierId", "email", "id", "isActive", "lastActivityAt", "lastEarnedAt", "lastRedeemedAt", "lifetimePoints", "metadata", "pointBalance", "referralCode", "referredByCode", "shopCustomerId", "shopId", "updatedAt") SELECT "acceptsMarketing", "birthday", "createdAt", "currentTierId", "email", "id", "isActive", "lastActivityAt", "lastEarnedAt", "lastRedeemedAt", "lifetimePoints", "metadata", "pointBalance", "referralCode", "referredByCode", "shopCustomerId", "shopId", "updatedAt" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE UNIQUE INDEX "Customer_referralCode_key" ON "Customer"("referralCode");
CREATE UNIQUE INDEX "Customer_referredByCode_key" ON "Customer"("referredByCode");
CREATE INDEX "Customer_shopId_email_idx" ON "Customer"("shopId", "email");
CREATE INDEX "Customer_referralCode_idx" ON "Customer"("referralCode");
CREATE INDEX "Customer_currentTierId_idx" ON "Customer"("currentTierId");
CREATE INDEX "Customer_pointBalance_idx" ON "Customer"("pointBalance");
CREATE INDEX "Customer_isActive_idx" ON "Customer"("isActive");
CREATE UNIQUE INDEX "Customer_shopId_shopCustomerId_key" ON "Customer"("shopId", "shopCustomerId");
CREATE TABLE "new_ProgramSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "pointsPerCurrency" INTEGER NOT NULL DEFAULT 1,
    "minOrderValueCents" INTEGER NOT NULL DEFAULT 1000,
    "rounding" TEXT NOT NULL DEFAULT 'nearest',
    "excludeDiscounts" BOOLEAN NOT NULL DEFAULT true,
    "earnOnShipping" BOOLEAN NOT NULL DEFAULT false,
    "earnOnTaxes" BOOLEAN NOT NULL DEFAULT false,
    "holdEvent" TEXT NOT NULL DEFAULT 'PAID',
    "maxPointsPerOrder" INTEGER,
    "dailyEarnCap" INTEGER,
    "monthlyEarnCap" INTEGER,
    "pointsPerReview" INTEGER NOT NULL DEFAULT 50,
    "maxReviewsPerMonth" INTEGER NOT NULL DEFAULT 2,
    "welcomeBonusBronze" INTEGER NOT NULL DEFAULT 100,
    "welcomeBonusSilver" INTEGER NOT NULL DEFAULT 300,
    "welcomeBonusGold" INTEGER NOT NULL DEFAULT 500,
    "birthdayPoints" INTEGER NOT NULL DEFAULT 200,
    "birthdayMinLeadDays" INTEGER NOT NULL DEFAULT 7,
    "pointsPerDollar" INTEGER NOT NULL DEFAULT 100,
    "minRedemptionPoints" INTEGER NOT NULL DEFAULT 100,
    "preventDiscountStacking" BOOLEAN NOT NULL DEFAULT false,
    "pointsExpiryMonths" INTEGER NOT NULL DEFAULT 12,
    "minSubtotalCents" INTEGER NOT NULL DEFAULT 0,
    "referralsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "referrerBonus" INTEGER,
    "refereeBonus" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProgramSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProgramSettings" ("createdAt", "dailyEarnCap", "earnOnShipping", "earnOnTaxes", "excludeDiscounts", "holdEvent", "id", "maxPointsPerOrder", "minSubtotalCents", "monthlyEarnCap", "pointsPerCurrency", "refereeBonus", "referralsEnabled", "referrerBonus", "rounding", "shopId", "status", "updatedAt") SELECT "createdAt", "dailyEarnCap", "earnOnShipping", "earnOnTaxes", "excludeDiscounts", "holdEvent", "id", "maxPointsPerOrder", "minSubtotalCents", "monthlyEarnCap", "pointsPerCurrency", "refereeBonus", "referralsEnabled", "referrerBonus", "rounding", "shopId", "status", "updatedAt" FROM "ProgramSettings";
DROP TABLE "ProgramSettings";
ALTER TABLE "new_ProgramSettings" RENAME TO "ProgramSettings";
CREATE UNIQUE INDEX "ProgramSettings_shopId_key" ON "ProgramSettings"("shopId");
CREATE TABLE "new_Tier" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "minPoints" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "icon" TEXT,
    "windowType" TEXT NOT NULL DEFAULT 'LIFETIME',
    "windowDays" INTEGER,
    "downgradeGraceDays" INTEGER,
    "benefits" JSONB,
    "spendMultiplier" REAL NOT NULL DEFAULT 1.0,
    "reviewMultiplier" REAL NOT NULL DEFAULT 1.0,
    "maxReviewsPerMonth" INTEGER NOT NULL DEFAULT 2,
    "multiplier" REAL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Tier_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Tier" ("benefits", "color", "createdAt", "downgradeGraceDays", "icon", "id", "minPoints", "multiplier", "name", "shopId", "sortOrder", "updatedAt", "windowDays", "windowType") SELECT "benefits", "color", "createdAt", "downgradeGraceDays", "icon", "id", "minPoints", "multiplier", "name", "shopId", "sortOrder", "updatedAt", "windowDays", "windowType" FROM "Tier";
DROP TABLE "Tier";
ALTER TABLE "new_Tier" RENAME TO "Tier";
CREATE INDEX "Tier_shopId_sortOrder_idx" ON "Tier"("shopId", "sortOrder");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
