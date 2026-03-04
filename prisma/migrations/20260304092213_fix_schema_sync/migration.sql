/*
  Warnings:

  - You are about to drop the column `currentMonthReviewCount` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `lastBirthdayPointsAt` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `lastReviewMonth` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `lastReviewPointsAt` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `lastReviewYear` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `nextBirthdayPointsAt` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `welcomeBonusBronzeAwarded` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `welcomeBonusGoldAwarded` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `welcomeBonusSilverAwarded` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `maxReviewsPerMonth` on the `Tier` table. All the data in the column will be lost.
  - You are about to drop the column `reviewMultiplier` on the `Tier` table. All the data in the column will be lost.
  - You are about to drop the column `spendMultiplier` on the `Tier` table. All the data in the column will be lost.

*/
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
    "referralCode" TEXT,
    "referredByCode" TEXT,
    "birthday" DATETIME,
    "lastEarnedAt" DATETIME,
    "lastRedeemedAt" DATETIME,
    "lastActivityAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Customer_currentTierId_fkey" FOREIGN KEY ("currentTierId") REFERENCES "Tier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Customer_referredByCode_fkey" FOREIGN KEY ("referredByCode") REFERENCES "Customer" ("referralCode") ON DELETE SET NULL ON UPDATE CASCADE
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
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "multiplier" REAL,
    CONSTRAINT "Tier_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Tier" ("benefits", "color", "createdAt", "downgradeGraceDays", "icon", "id", "minPoints", "multiplier", "name", "shopId", "sortOrder", "updatedAt", "windowDays", "windowType") SELECT "benefits", "color", "createdAt", "downgradeGraceDays", "icon", "id", "minPoints", "multiplier", "name", "shopId", "sortOrder", "updatedAt", "windowDays", "windowType" FROM "Tier";
DROP TABLE "Tier";
ALTER TABLE "new_Tier" RENAME TO "Tier";
CREATE INDEX "Tier_shopId_sortOrder_idx" ON "Tier"("shopId", "sortOrder");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
