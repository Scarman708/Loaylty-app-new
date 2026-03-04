import { json, type LoaderFunction, type ActionFunction } from '@remix-run/node';
import { authenticate } from '~/shopify.server';
import { loyaltyProgram } from '~/services/loyaltyProgram.server';
import prisma from '~/db.server';

export const loader: LoaderFunction = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const customerId = url.searchParams.get('customerId');

  if (!customerId) {
    return json({ error: 'Customer ID is required' }, { status: 400 });
  }

  try {
    // Get customer loyalty info
    const customer = await prisma.customer.findUnique({
      where: { 
        shopId_shopCustomerId: { 
          shopId: session.shop, 
          shopCustomerId: BigInt(customerId) 
        } 
      },
      include: {
        currentTier: true,
        pointTransactions: {
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!customer) {
      return json({ error: 'Customer not found' }, { status: 404 });
    }

    return json({
      points: customer.pointBalance,
      lifetimePoints: customer.lifetimePoints,
      tier: customer.currentTier,
      recentTransactions: customer.pointTransactions,
    });
  } catch (error) {
    console.error('Error fetching loyalty info:', error);
    return json({ error: 'Failed to fetch loyalty info' }, { status: 500 });
  }
};

export const action: ActionFunction = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get('_action');
  const customerId = formData.get('customerId');

  if (!customerId) {
    return json({ error: 'Customer ID is required' }, { status: 400 });
  }

  try {
    switch (action) {
      case 'processOrder': {
        const orderId = formData.get('orderId');
        const subtotal = Number(formData.get('subtotal'));
        
        if (!orderId || isNaN(subtotal)) {
          return json({ error: 'Invalid order data' }, { status: 400 });
        }

        const result = await loyaltyProgram.processOrderPoints(
          session.shop as unknown as number, // Convert shop string to number
          Number(customerId), // Convert customerId to number
          subtotal,
          orderId.toString()
        );
        
        return json(result);
      }

      case 'processReview': {
        const reviewId = formData.get('reviewId');
        
        if (!reviewId) {
          return json({ error: 'Review ID is required' }, { status: 400 });
        }

const result = await loyaltyProgram.processReview(
          session.shop as unknown as number, // Convert shop string to number
          Number(customerId), // Convert customerId to number
          reviewId.toString()
        );
        
        return json(result);
      }

      case 'awardWelcomeBonus': {
await loyaltyProgram.awardWelcomeBonus(
          session.shop as unknown as number, // Convert shop string to number
          Number(customerId) // Convert customerId to number
        );
        return json({ success: true });
      }

      case 'processBirthday': {
const result = await loyaltyProgram.processBirthdayReward(
          session.shop as unknown as number, // Convert shop string to number
          Number(customerId) // Convert customerId to number
        );
        return json(result);
      }

      case 'redeemPoints': {
        const points = Number(formData.get('points'));
        
        if (isNaN(points) || points <= 0) {
          return json({ error: 'Invalid points amount' }, { status: 400 });
        }

const result = await loyaltyProgram.redeemPoints(
          session.shop as unknown as number, // Convert shop string to number
          Number(customerId), // Convert customerId to number
          points
        );
        
        return json(result);
      }

      default:
        return json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error: any) {
    console.error(`Error in loyalty action ${action}:`, error);
    return json(
      { error: error.message || 'An error occurred' },
      { status: 400 }
    );
  }
};
