-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProgramSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "pointsPerCurrency" INTEGER NOT NULL DEFAULT 1,
    "rounding" TEXT NOT NULL DEFAULT 'nearest',
    "excludeDiscounts" BOOLEAN NOT NULL DEFAULT true,
    "earnOnShipping" BOOLEAN NOT NULL DEFAULT false,
    "earnOnTaxes" BOOLEAN NOT NULL DEFAULT false,
    "holdEvent" TEXT NOT NULL DEFAULT 'PAID',
    "minSubtotalCents" INTEGER NOT NULL DEFAULT 1000,
    "maxPointsPerOrder" INTEGER,
    "dailyEarnCap" INTEGER,
    "monthlyEarnCap" INTEGER,
    "referralsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "referrerBonus" INTEGER,
    "refereeBonus" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "reviewBasePoints" INTEGER NOT NULL DEFAULT 50,
    "maxReviewsPerMonth" INTEGER NOT NULL DEFAULT 2,
    "bronzeSignupBonus" INTEGER NOT NULL DEFAULT 100,
    "silverUnlockBonus" INTEGER NOT NULL DEFAULT 300,
    "goldUnlockBonus" INTEGER NOT NULL DEFAULT 500,
    "birthdayPoints" INTEGER NOT NULL DEFAULT 200,
    "birthdayExpiryDays" INTEGER NOT NULL DEFAULT 30,
    "birthdayMinDays" INTEGER NOT NULL DEFAULT 7,
    "bronzeSpendMultiplier" REAL NOT NULL DEFAULT 1.0,
    "bronzeReviewMultiplier" REAL NOT NULL DEFAULT 1.0,
    "silverSpendMultiplier" REAL NOT NULL DEFAULT 1.25,
    "silverReviewMultiplier" REAL NOT NULL DEFAULT 1.5,
    "goldSpendMultiplier" REAL NOT NULL DEFAULT 1.5,
    "goldReviewMultiplier" REAL NOT NULL DEFAULT 2.0,
    "bronzeThreshold" INTEGER NOT NULL DEFAULT 0,
    "silverThreshold" INTEGER NOT NULL DEFAULT 2000,
    "goldThreshold" INTEGER NOT NULL DEFAULT 5000,
    "redemptionRate" INTEGER NOT NULL DEFAULT 100,
    "redemptionValue" INTEGER NOT NULL DEFAULT 5,
    "minRedemption" INTEGER NOT NULL DEFAULT 100,
    "preventStacking" BOOLEAN NOT NULL DEFAULT false,
    "pointsExpiryMonths" INTEGER NOT NULL DEFAULT 12,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProgramSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ProgramSettings" ("createdAt", "dailyEarnCap", "earnOnShipping", "earnOnTaxes", "excludeDiscounts", "holdEvent", "id", "maxPointsPerOrder", "minSubtotalCents", "monthlyEarnCap", "pointsPerCurrency", "refereeBonus", "referralsEnabled", "referrerBonus", "rounding", "shopId", "status", "updatedAt") SELECT "createdAt", "dailyEarnCap", "earnOnShipping", "earnOnTaxes", "excludeDiscounts", "holdEvent", "id", "maxPointsPerOrder", "minSubtotalCents", "monthlyEarnCap", "pointsPerCurrency", "refereeBonus", "referralsEnabled", "referrerBonus", "rounding", "shopId", "status", "updatedAt" FROM "ProgramSettings";
DROP TABLE "ProgramSettings";
ALTER TABLE "new_ProgramSettings" RENAME TO "ProgramSettings";
CREATE UNIQUE INDEX "ProgramSettings_shopId_key" ON "ProgramSettings"("shopId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
