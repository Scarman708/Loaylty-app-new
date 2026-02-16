import prisma from '~/db.server';
import type { Prisma } from '@prisma/client';

type AddPointsInput = {
  shopId: number;
  customerId: number;
  points: number;
  description: string;
  type?: string;
  referenceId?: string;
  expiresAt?: Date;
  metadata?: Record<string, any>;
};

/**
 * Adds points to a customer's loyalty account
 */
export async function addPoints({
  shopId,
  customerId,
  points,
  description,
  type = 'earn',
  referenceId,
  expiresAt,
  metadata,
}: AddPointsInput) {
  return await prisma.$transaction(async (tx) => {
    // Update or create customer record
    const customer = await tx.customer.upsert({
      where: {
        shopId_shopCustomerId: {
          shopId,
          shopCustomerId: BigInt(customerId),
        },
      },
      update: {
        pointBalance: {
          increment: points,
        },
        lifetimePoints: {
          increment: points > 0 ? points : 0,
        },
        lastActivityAt: new Date(),
        ...(points > 0 && { lastEarnedAt: new Date() }),
      },
      create: {
        shopId,
        shopCustomerId: BigInt(customerId),
        pointBalance: points,
        lifetimePoints: points > 0 ? points : 0,
        lastActivityAt: new Date(),
        ...(points > 0 && { lastEarnedAt: new Date() }),
      },
    });

    // Record the transaction
    await tx.loyaltyPoint.create({
      data: {
        customerId: customer.id,
        shopId,
        points,
        type,
        description,
        referenceId,
        expiresAt,
        status: 'active',
        metadata,
      },
    });

    // Update customer tier if needed
    if (points > 0) {
      await updateCustomerTier(tx, customer.id, shopId);
    }

    return customer;
  });
}

/**
 * Redeems points from a customer's loyalty account
 */
export async function redeemPoints({
  shopId,
  customerId,
  points,
  description,
  referenceId,
  metadata,
}: Omit<AddPointsInput, 'type'>) {
  return await prisma.$transaction(async (tx) => {
    // First, check if customer has enough points
    const customer = await tx.customer.findUnique({
      where: {
        shopId_shopCustomerId: {
          shopId,
          shopCustomerId: BigInt(customerId),
        },
      },
    });

    if (!customer) {
      throw new Error('Customer not found');
    }

    if (customer.pointBalance < points) {
      throw new Error('Insufficient points');
    }

    // Deduct points
    const updatedCustomer = await tx.customer.update({
      where: { id: customer.id },
      data: {
        pointBalance: {
          decrement: points,
        },
        lastActivityAt: new Date(),
        lastRedeemedAt: new Date(),
      },
    });

    // Record the redemption
    await tx.loyaltyPoint.create({
      data: {
        customerId: customer.id,
        shopId,
        points: -points, // Negative points for redemption
        type: 'redeem',
        description,
        referenceId,
        status: 'used',
        metadata,
      },
    });

    return updatedCustomer;
  });
}

/**
 * Updates a customer's tier based on their points
 */
async function updateCustomerTier(
  tx: Prisma.TransactionClient,
  customerId: number,
  shopId: number
) {
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    include: { currentTier: true },
  });

  if (!customer) return;

  // Find the appropriate tier based on points
  const newTier = await tx.tier.findFirst({
    where: {
      shopId,
      minPoints: {
        lte: customer.pointBalance,
      },
    },
    orderBy: {
      minPoints: 'desc',
    },
  });

  // Update customer's tier if it's different from current
  if (newTier && (!customer.currentTierId || newTier.id !== customer.currentTierId)) {
    await tx.customer.update({
      where: { id: customerId },
      data: {
        currentTierId: newTier.id,
      },
    });
  }
}

/**
 * Gets customer's loyalty information
 */
export async function getCustomerLoyaltyInfo(shopId: number, customerId: number) {
  return await prisma.customer.findUnique({
    where: {
      shopId_shopCustomerId: {
        shopId,
        shopCustomerId: BigInt(customerId),
      },
    },
    include: {
      currentTier: true,
      pointTransactions: {
        take: 10,
        orderBy: {
          createdAt: 'desc',
        },
      },
      redemptions: {
        take: 10,
        orderBy: {
          createdAt: 'desc',
        },
      },
    },
  });
}
