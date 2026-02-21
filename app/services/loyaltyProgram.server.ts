import { PrismaClient, Prisma } from '@prisma/client';
import prisma from '~/db.server';

type LoyaltyProgramService = ReturnType<typeof createLoyaltyProgramService>;

export function createLoyaltyProgramService(db: PrismaClient) {
  // Helper: Award Tier Upgrade Bonus
  async function awardTierUpgradeBonus(shopId: number, customer: any, newTier: any) {
    const settings = await db.programSettings.findUnique({ where: { shopId } });
    if (!settings) return;

    let bonusPoints = 0;
    let bonusAwarded = false;

    // Check and award Silver welcome bonus
    if (newTier.name.toLowerCase().includes('silver') && !customer.welcomeBonusSilverAwarded) {
      bonusPoints += settings.welcomeBonusSilver;
      bonusAwarded = true;
      await db.customer.update({
        where: { id: customer.id },
        data: { welcomeBonusSilverAwarded: true }
      });
    }
    // Check and award Gold welcome bonus
    else if (newTier.name.toLowerCase().includes('gold') && !customer.welcomeBonusGoldAwarded) {
      bonusPoints += settings.welcomeBonusGold;
      bonusAwarded = true;
      await db.customer.update({
        where: { id: customer.id },
        data: { welcomeBonusGoldAwarded: true }
      });
    }

    if (bonusAwarded && bonusPoints > 0) {
      await addPoints({
        shopId,
        customerId: customer.id,
        points: bonusPoints,
        description: `Welcome bonus (${newTier.name})`,
        type: 'WELCOME_BONUS',
      });
    }
  }

  // Helper: Add Points
  async function addPoints(params: {
    shopId: number;
    customerId: number;
    points: number;
    description: string;
    type: string;
    referenceId?: string;
    expiresAt?: Date;
  }) {
    const { shopId, customerId, points, description, type, referenceId, expiresAt } = params;

    return await db.$transaction([
      db.customer.update({
        where: { id: customerId },
        data: {
          pointBalance: { increment: points },
          lifetimePoints: { increment: points > 0 ? points : 0 },
          lastActivityAt: new Date(),
          ...(points > 0 && { lastEarnedAt: new Date() }),
        },
      }),
      db.loyaltyPoint.create({
        data: {
          customerId,
          shopId,
          points,
          type,
          description,
          referenceId,
          expiresAt,
          status: 'ACTIVE',
        },
      }),
    ]);
  }

  // Helper: Check Review Limit
  async function checkReviewLimit(customer: any) {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Reset counter if it's a new month
    if (
      customer.lastReviewMonth !== currentMonth ||
      customer.lastReviewYear !== currentYear
    ) {
      await db.customer.update({
        where: { id: customer.id },
        data: {
          currentMonthReviewCount: 0,
          lastReviewMonth: currentMonth,
          lastReviewYear: currentYear,
        },
      });
      customer.currentMonthReviewCount = 0;
    }

    // Check if customer has reached their monthly review limit
    const maxReviews = customer.currentTier?.maxReviewsPerMonth || 2;
    if (customer.currentMonthReviewCount >= maxReviews) {
      throw new Error('Monthly review limit reached');
    }
  }

  return {
    // Order Processing
    async processOrderPoints(shopId: number, customerId: number, orderSubtotal: number, orderId: string) {
      const [settings, customer] = await Promise.all([
        db.programSettings.findUnique({ where: { shopId } }),
        db.customer.findUnique({
          where: { shopId_shopCustomerId: { shopId, shopCustomerId: BigInt(customerId) } },
          include: { currentTier: true }
        })
      ]);

      if (!settings || !customer) {
        throw new Error('Invalid shop or customer');
      }

      // Check minimum order value
      if (settings.minOrderValueCents > 0 && orderSubtotal < settings.minOrderValueCents) {
        return { points: 0, message: 'Order does not meet minimum value requirement' };
      }

      // Calculate base points (1 point per currency unit)
      const basePoints = Math.floor(orderSubtotal / 100) * settings.pointsPerCurrency;
      
      // Apply tier multiplier if available
      const multiplier = customer.currentTier?.spendMultiplier || 1;
      const finalPoints = Math.floor(basePoints * multiplier);

      // Add points to customer's balance
      await db.$transaction([
        db.customer.update({
          where: { id: customer.id },
          data: {
            pointBalance: { increment: finalPoints },
            lifetimePoints: { increment: finalPoints },
            lastActivityAt: new Date(),
            lastEarnedAt: new Date(),
          },
        }),
        db.loyaltyPoint.create({
          data: {
            customerId: customer.id,
            shopId,
            points: finalPoints,
            type: 'PURCHASE',
            description: `Points earned from order #${orderId}`,
            referenceId: orderId,
            status: 'ACTIVE',
          },
        }),
      ]);

      // Check for tier updates
      await this.updateCustomerTier(shopId, customerId);

      return { points: finalPoints };
    },

    // Review Rewards
    async processReview(shopId: number, customerId: number, reviewId: string) {
      const [settings, customer] = await Promise.all([
        db.programSettings.findUnique({ where: { shopId } }),
        db.customer.findUnique({
          where: { shopId_shopCustomerId: { shopId, shopCustomerId: BigInt(customerId) } },
          include: { currentTier: true }
        })
      ]);

      if (!settings || !customer) {
        throw new Error('Invalid shop or customer');
      }

      // Check monthly review limit
      await checkReviewLimit(customer);

      // Calculate points with tier multiplier
      const basePoints = settings.pointsPerReview;
      const multiplier = customer.currentTier?.reviewMultiplier || 1;
      const finalPoints = Math.floor(basePoints * multiplier);

      // Update customer's review count and points
      await db.$transaction([
        db.customer.update({
          where: { id: customer.id },
          data: {
            pointBalance: { increment: finalPoints },
            lifetimePoints: { increment: finalPoints },
            lastActivityAt: new Date(),
            lastReviewPointsAt: new Date(),
            currentMonthReviewCount: { increment: 1 },
            lastReviewMonth: new Date().getMonth() + 1,
            lastReviewYear: new Date().getFullYear(),
          },
        }),
        db.loyaltyPoint.create({
          data: {
            customerId: customer.id,
            shopId,
            points: finalPoints,
            type: 'REVIEW',
            description: 'Points earned for submitting a review',
            referenceId: reviewId,
            status: 'ACTIVE',
          },
        }),
      ]);

      return { points: finalPoints };
    },

    // Welcome Bonuses
    async awardWelcomeBonus(shopId: number, customerId: number) {
      const customer = await db.customer.findUnique({
        where: { shopId_shopCustomerId: { shopId, shopCustomerId: BigInt(customerId) } },
        include: { currentTier: true }
      });

      if (!customer) {
        throw new Error('Customer not found');
      }

      // Award bronze welcome bonus if not already awarded
      if (!customer.welcomeBonusBronzeAwarded) {
        const settings = await db.programSettings.findUnique({ where: { shopId } });
        if (settings) {
          await addPoints({
            shopId,
            customerId: customer.id,
            points: settings.welcomeBonusBronze,
            description: 'Welcome bonus (Bronze)',
            type: 'WELCOME_BONUS',
          });
          
          await db.customer.update({
            where: { id: customer.id },
            data: { welcomeBonusBronzeAwarded: true }
          });
        }
      }

      // Tier-based welcome bonuses are handled in updateCustomerTier
    },

    // Update Customer Tier
    async updateCustomerTier(shopId: number, customerId: number) {
      const [customer, tiers] = await Promise.all([
        db.customer.findUnique({
          where: { shopId_shopCustomerId: { shopId, shopCustomerId: BigInt(customerId) } },
          include: { currentTier: true }
        }),
        db.tier.findMany({
          where: { shopId },
          orderBy: { minPoints: 'asc' }
        })
      ]);

      if (!customer) {
        throw new Error('Customer not found');
      }

      // Find the highest tier the customer qualifies for
      let newTier = null;
      for (const tier of tiers) {
        if (customer.lifetimePoints >= tier.minPoints) {
          newTier = tier;
        } else {
          break;
        }
      }

      // If no tier found, assign the lowest tier
      if (!newTier && tiers.length > 0) {
        newTier = tiers[0];
      }

      if (newTier && (!customer.currentTierId || newTier.id !== customer.currentTierId)) {
        await db.customer.update({
          where: { id: customer.id },
          data: { currentTierId: newTier.id }
        });

        // Award tier upgrade bonus if applicable
        await awardTierUpgradeBonus(shopId, customer, newTier);
      }
    },

    // Helper: Award Tier Upgrade Bonus
    async awardTierUpgradeBonus(shopId: number, customer: any, newTier: any) {
      const settings = await db.programSettings.findUnique({ where: { shopId } });
      if (!settings) return;

      let bonusPoints = 0;
      let bonusAwarded = false;

      // Check and award Silver welcome bonus
      if (newTier.name.toLowerCase().includes('silver') && !customer.welcomeBonusSilverAwarded) {
        bonusPoints += settings.welcomeBonusSilver;
        bonusAwarded = true;
        await db.customer.update({
          where: { id: customer.id },
          data: { welcomeBonusSilverAwarded: true }
        });
      }
      // Check and award Gold welcome bonus
      else if (newTier.name.toLowerCase().includes('gold') && !customer.welcomeBonusGoldAwarded) {
        bonusPoints += settings.welcomeBonusGold;
        bonusAwarded = true;
        await db.customer.update({
          where: { id: customer.id },
          data: { welcomeBonusGoldAwarded: true }
        });
      }

      if (bonusAwarded && bonusPoints > 0) {
        await addPoints({
          shopId,
          customerId: customer.id,
          points: bonusPoints,
          description: `Welcome bonus (${newTier.name})`,
          type: 'WELCOME_BONUS',
        });
      }
    },

    // Check Review Limit
    async checkReviewLimit(customer: any) {
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();

      // Reset counter if it's a new month
      if (
        customer.lastReviewMonth !== currentMonth ||
        customer.lastReviewYear !== currentYear
      ) {
        await db.customer.update({
          where: { id: customer.id },
          data: {
            currentMonthReviewCount: 0,
            lastReviewMonth: currentMonth,
            lastReviewYear: currentYear,
          },
        });
        customer.currentMonthReviewCount = 0;
      }

      // Check if customer has reached their monthly review limit
      const maxReviews = customer.currentTier?.maxReviewsPerMonth || 2;
      if (customer.currentMonthReviewCount >= maxReviews) {
        throw new Error('Monthly review limit reached');
      }
    },

    // Add Points Helper
    async addPoints(params: {
      shopId: number;
      customerId: number;
      points: number;
      description: string;
      type: string;
      referenceId?: string;
      expiresAt?: Date;
    }) {
      const { shopId, customerId, points, description, type, referenceId, expiresAt } = params;

      return await db.$transaction([
        db.customer.update({
          where: { id: customerId },
          data: {
            pointBalance: { increment: points },
            lifetimePoints: { increment: points > 0 ? points : 0 },
            lastActivityAt: new Date(),
            ...(points > 0 && { lastEarnedAt: new Date() }),
          },
        }),
        db.loyaltyPoint.create({
          data: {
            customerId,
            shopId,
            points,
            type,
            description,
            referenceId,
            expiresAt,
            status: 'ACTIVE',
          },
        }),
      ]);
    },

    // Process Birthday Reward
    async processBirthdayReward(shopId: number, customerId: number) {
      const [settings, customer] = await Promise.all([
        db.programSettings.findUnique({ where: { shopId } }),
        db.customer.findUnique({
          where: { shopId_shopCustomerId: { shopId, shopCustomerId: BigInt(customerId) } },
        })
      ]);

      if (!settings || !customer?.birthday) {
        throw new Error('Invalid customer or missing birthday');
      }

      const now = new Date();
      const lastBirthday = customer.lastBirthdayPointsAt 
        ? new Date(customer.lastBirthdayPointsAt)
        : null;
      
      // Check if already awarded this year
      if (lastBirthday && lastBirthday.getFullYear() === now.getFullYear()) {
        throw new Error('Birthday reward already awarded this year');
      }

      // Check if birthday is within the next 7 days
      const birthdayThisYear = new Date(now.getFullYear(), customer.birthday.getMonth(), customer.birthday.getDate());
      const daysUntilBirthday = Math.ceil((birthdayThisYear.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysUntilBirthday < 0 || daysUntilBirthday > settings.birthdayMinLeadDays) {
        throw new Error('Not eligible for birthday reward yet');
      }

      // Calculate expiration (30 days from now)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      // Add birthday points
      await addPoints({
        shopId,
        customerId: customer.id,
        points: settings.birthdayPoints,
        description: 'Happy Birthday!',
        type: 'BIRTHDAY',
        expiresAt,
      });

      // Update last birthday reward date
      await db.customer.update({
        where: { id: customer.id },
        data: {
          lastBirthdayPointsAt: now,
          nextBirthdayPointsAt: new Date(now.getFullYear() + 1, customer.birthday.getMonth(), 1)
        }
      });

      return { points: settings.birthdayPoints, expiresAt };
    },

    // Redeem Points
    async redeemPoints(shopId: number, customerId: number, points: number) {
      const [settings, customer] = await Promise.all([
        db.programSettings.findUnique({ where: { shopId } }),
        db.customer.findUnique({
          where: { shopId_shopCustomerId: { shopId, shopCustomerId: BigInt(customerId) } },
        })
      ]);

      if (!settings || !customer) {
        throw new Error('Invalid shop or customer');
      }

      // Validate minimum redemption amount
      if (points < settings.minRedemptionPoints) {
        throw new Error(`Minimum redemption is ${settings.minRedemptionPoints} points`);
      }

      // Check sufficient balance
      if (customer.pointBalance < points) {
        throw new Error('Insufficient points');
      }

      // Calculate discount amount
      const discountAmount = (points / settings.pointsPerDollar) * 100; // Convert to cents

      // Record redemption
      await db.$transaction([
        db.customer.update({
          where: { id: customer.id },
          data: {
            pointBalance: { decrement: points },
            lastActivityAt: new Date(),
            lastRedeemedAt: new Date(),
          },
        }),
        db.loyaltyPoint.create({
          data: {
            customerId: customer.id,
            shopId,
            points: -points,
            type: 'REDEMPTION',
            description: `Redeemed ${points} points for $${(discountAmount / 100).toFixed(2)} discount`,
            status: 'USED',
          },
        }),
      ]);

      return { 
        pointsRedeemed: points, 
        discountAmountCents: discountAmount,
        discountAmount: discountAmount / 100 
      };
    },

    // Process Points Expiration
    async processExpiredPoints() {
      const settings = await db.programSettings.findMany();
      
      for (const setting of settings) {
        if (setting.pointsExpiryMonths <= 0) continue;

        const expirationDate = new Date();
        expirationDate.setMonth(expirationDate.getMonth() - setting.pointsExpiryMonths);

        // Find points that are about to expire
        const expiringPoints = await db.loyaltyPoint.findMany({
          where: {
            shopId: setting.shopId,
            status: 'ACTIVE',
            expiresAt: { lte: new Date() },
          },
          include: { customer: true },
        });

        // Process expiring points in batches
        for (const point of expiringPoints) {
          await db.$transaction([
            // Mark points as expired
            db.loyaltyPoint.update({
              where: { id: point.id },
              data: { status: 'EXPIRED' },
            }),
            // Optionally, create an expiration record
            db.loyaltyPoint.create({
              data: {
                customerId: point.customerId,
                shopId: setting.shopId,
                points: -point.points,
                type: 'EXPIRATION',
                description: `Expired ${point.points} points`,
                status: 'EXPIRED',
                referenceId: `exp-${point.id}`,
              },
            }),
          ]);
        }
      }
    },
  };
}

export const loyaltyProgram = createLoyaltyProgramService(prisma);

export type { LoyaltyProgramService };
