-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
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
    CONSTRAINT "Customer_referredByCode_fkey" FOREIGN KEY ("referredByCode") REFERENCES "Customer" ("referredByCode") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Customer_currentTierId_fkey" FOREIGN KEY ("currentTierId") REFERENCES "Tier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Customer" ("acceptsMarketing", "birthday", "createdAt", "currentTierId", "email", "id", "lastEarnedAt", "lastRedeemedAt", "lifetimePoints", "pointBalance", "referralCode", "referredByCode", "shopCustomerId", "shopId", "updatedAt") SELECT "acceptsMarketing", "birthday", "createdAt", "currentTierId", "email", "id", "lastEarnedAt", "lastRedeemedAt", "lifetimePoints", "pointBalance", "referralCode", "referredByCode", "shopCustomerId", "shopId", "updatedAt" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE UNIQUE INDEX "Customer_referralCode_key" ON "Customer"("referralCode");
CREATE UNIQUE INDEX "Customer_referredByCode_key" ON "Customer"("referredByCode");
CREATE INDEX "Customer_shopId_email_idx" ON "Customer"("shopId", "email");
CREATE UNIQUE INDEX "Customer_shopId_shopCustomerId_key" ON "Customer"("shopId", "shopCustomerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
