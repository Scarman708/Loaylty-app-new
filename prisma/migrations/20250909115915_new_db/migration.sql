-- CreateTable
CREATE TABLE "Shop" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopDomain" TEXT NOT NULL,
    "shopId" BIGINT,
    "accessToken" TEXT,
    "currencyCode" TEXT,
    "installedAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ProgramSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "pointsPerCurrency" INTEGER NOT NULL DEFAULT 10,
    "rounding" TEXT NOT NULL DEFAULT 'nearest',
    "excludeDiscounts" BOOLEAN NOT NULL DEFAULT false,
    "earnOnShipping" BOOLEAN NOT NULL DEFAULT false,
    "earnOnTaxes" BOOLEAN NOT NULL DEFAULT false,
    "holdEvent" TEXT NOT NULL DEFAULT 'PAID',
    "minSubtotalCents" INTEGER NOT NULL DEFAULT 0,
    "maxPointsPerOrder" INTEGER,
    "dailyEarnCap" INTEGER,
    "monthlyEarnCap" INTEGER,
    "referralsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "referrerBonus" INTEGER,
    "refereeBonus" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProgramSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExpiryPolicy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'NONE',
    "rollingDays" INTEGER,
    "fixedDate" DATETIME,
    "issueGraceDays" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ExpiryPolicy_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EarningRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "multiplier" REAL,
    "fixedPoints" INTEGER,
    "applyOncePerOrder" BOOLEAN NOT NULL DEFAULT false,
    "capPerOrder" INTEGER,
    "capPerCustomer" INTEGER,
    "capWindowUnit" TEXT,
    "capWindowCount" INTEGER,
    "conditions" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "activeFrom" DATETIME,
    "activeUntil" DATETIME,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EarningRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RedemptionRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "minPoints" INTEGER NOT NULL DEFAULT 0,
    "stepPoints" INTEGER,
    "discountCents" INTEGER,
    "discountPercent" REAL,
    "maxDiscountCents" INTEGER,
    "requiresCode" BOOLEAN NOT NULL DEFAULT false,
    "conditions" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "activeFrom" DATETIME,
    "activeUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RedemptionRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Tier" (
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
    CONSTRAINT "Tier_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "shopCustomerId" BIGINT NOT NULL,
    "email" TEXT,
    "acceptsMarketing" BOOLEAN,
    "pointBalance" INTEGER NOT NULL DEFAULT 0,
    "lifetimePoints" INTEGER NOT NULL DEFAULT 0,
    "currentTierId" INTEGER,
    "referralCode" TEXT,
    "referredByCode" TEXT,
    "birthday" DATETIME,
    "lastEarnedAt" DATETIME,
    "lastRedeemedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Customer_currentTierId_fkey" FOREIGN KEY ("currentTierId") REFERENCES "Tier" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PointLedger" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "orderId" BIGINT,
    "orderName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "availableAt" DATETIME,
    "expiresAt" DATETIME,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PointLedger_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PointLedger_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RewardRedemption" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "ruleId" INTEGER NOT NULL,
    "pointsSpent" INTEGER NOT NULL,
    "code" TEXT,
    "valueCents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "orderId" BIGINT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RewardRedemption_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RewardRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RewardRedemption_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "RedemptionRule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BalanceSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL,
    "lifetimePoints" INTEGER NOT NULL,
    "tierId" INTEGER,
    "takenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BalanceSnapshot_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BalanceSnapshot_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoalConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SUBTOTAL',
    "subtotalCents" INTEGER,
    "pointsGoal" INTEGER,
    "barEnabled" BOOLEAN NOT NULL DEFAULT true,
    "barColorFg" TEXT,
    "barColorBg" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoalConfig_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shopId" INTEGER NOT NULL,
    "topic" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "statusCode" INTEGER,
    "payload" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX "Shop_status_idx" ON "Shop"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramSettings_shopId_key" ON "ProgramSettings"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "ExpiryPolicy_shopId_key" ON "ExpiryPolicy"("shopId");

-- CreateIndex
CREATE INDEX "EarningRule_shopId_type_enabled_priority_idx" ON "EarningRule"("shopId", "type", "enabled", "priority");

-- CreateIndex
CREATE INDEX "RedemptionRule_shopId_type_enabled_idx" ON "RedemptionRule"("shopId", "type", "enabled");

-- CreateIndex
CREATE INDEX "Tier_shopId_sortOrder_idx" ON "Tier"("shopId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_referralCode_key" ON "Customer"("referralCode");

-- CreateIndex
CREATE INDEX "Customer_shopId_email_idx" ON "Customer"("shopId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_shopId_shopCustomerId_key" ON "Customer"("shopId", "shopCustomerId");

-- CreateIndex
CREATE INDEX "PointLedger_shopId_customerId_status_idx" ON "PointLedger"("shopId", "customerId", "status");

-- CreateIndex
CREATE INDEX "PointLedger_shopId_orderId_idx" ON "PointLedger"("shopId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardRedemption_code_key" ON "RewardRedemption"("code");

-- CreateIndex
CREATE INDEX "RewardRedemption_shopId_customerId_status_idx" ON "RewardRedemption"("shopId", "customerId", "status");

-- CreateIndex
CREATE INDEX "BalanceSnapshot_shopId_customerId_takenAt_idx" ON "BalanceSnapshot"("shopId", "customerId", "takenAt");

-- CreateIndex
CREATE UNIQUE INDEX "GoalConfig_shopId_key" ON "GoalConfig"("shopId");

-- CreateIndex
CREATE INDEX "WebhookLog_shopId_topic_createdAt_idx" ON "WebhookLog"("shopId", "topic", "createdAt");
