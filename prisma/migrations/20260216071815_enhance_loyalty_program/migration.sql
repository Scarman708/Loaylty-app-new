/*
  Warnings:

  - You are about to drop the column `pointsSpent` on the `RewardRedemption` table. All the data in the column will be lost.
  - Added the required column `pointsUsed` to the `RewardRedemption` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rewardType` to the `RewardRedemption` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rewardValue` to the `RewardRedemption` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "LoyaltyPoint" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" INTEGER NOT NULL,
    "shopId" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "referenceId" TEXT,
    "expiresAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LoyaltyPoint_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LoyaltyPoint_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

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
    CONSTRAINT "Customer_referredByCode_fkey" FOREIGN KEY ("referredByCode") REFERENCES "Customer" ("referralCode") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Customer_currentTierId_fkey" FOREIGN KEY ("currentTierId") REFERENCES "Tier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Customer" ("acceptsMarketing", "birthday", "createdAt", "currentTierId", "email", "id", "lastEarnedAt", "lastRedeemedAt", "lifetimePoints", "pointBalance", "referralCode", "referredByCode", "shopCustomerId", "shopId", "updatedAt") SELECT "acceptsMarketing", "birthday", "createdAt", "currentTierId", "email", "id", "lastEarnedAt", "lastRedeemedAt", "lifetimePoints", "pointBalance", "referralCode", "referredByCode", "shopCustomerId", "shopId", "updatedAt" FROM "Customer";
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
CREATE TABLE "new_RewardRedemption" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "pointsUsed" INTEGER NOT NULL,
    "rewardType" TEXT NOT NULL,
    "rewardValue" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'redeemed',
    "referenceId" TEXT,
    "metadata" JSONB,
    "processedAt" DATETIME,
    "expiresAt" DATETIME,
    "ruleId" INTEGER,
    "code" TEXT,
    "valueCents" INTEGER,
    "orderId" BIGINT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RewardRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RewardRedemption_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RewardRedemption_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "RedemptionRule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RewardRedemption" ("code", "createdAt", "customerId", "id", "metadata", "orderId", "ruleId", "shopId", "status", "updatedAt", "valueCents") SELECT "code", "createdAt", "customerId", "id", "metadata", "orderId", "ruleId", "shopId", "status", "updatedAt", "valueCents" FROM "RewardRedemption";
DROP TABLE "RewardRedemption";
ALTER TABLE "new_RewardRedemption" RENAME TO "RewardRedemption";
CREATE UNIQUE INDEX "RewardRedemption_code_key" ON "RewardRedemption"("code");
CREATE INDEX "RewardRedemption_customerId_idx" ON "RewardRedemption"("customerId");
CREATE INDEX "RewardRedemption_shopId_idx" ON "RewardRedemption"("shopId");
CREATE INDEX "RewardRedemption_status_idx" ON "RewardRedemption"("status");
CREATE INDEX "RewardRedemption_rewardType_idx" ON "RewardRedemption"("rewardType");
CREATE INDEX "RewardRedemption_referenceId_idx" ON "RewardRedemption"("referenceId");
CREATE INDEX "RewardRedemption_shopId_customerId_status_idx" ON "RewardRedemption"("shopId", "customerId", "status");
CREATE INDEX "RewardRedemption_shopId_orderId_idx" ON "RewardRedemption"("shopId", "orderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "LoyaltyPoint_customerId_idx" ON "LoyaltyPoint"("customerId");

-- CreateIndex
CREATE INDEX "LoyaltyPoint_shopId_idx" ON "LoyaltyPoint"("shopId");

-- CreateIndex
CREATE INDEX "LoyaltyPoint_type_idx" ON "LoyaltyPoint"("type");

-- CreateIndex
CREATE INDEX "LoyaltyPoint_status_idx" ON "LoyaltyPoint"("status");

-- CreateIndex
CREATE INDEX "LoyaltyPoint_expiresAt_idx" ON "LoyaltyPoint"("expiresAt");

-- CreateIndex
CREATE INDEX "LoyaltyPoint_referenceId_idx" ON "LoyaltyPoint"("referenceId");
