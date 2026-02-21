import { json, type ActionFunction } from '@remix-run/node';
import { authenticate } from '~/shopify.server';
import prisma from '~/db.server';
import { loyaltyProgram } from '~/services/loyaltyProgram.server';

export const action: ActionFunction = async ({ request }) => {
  const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

  if (topic !== 'CUSTOMERS_CREATE') {
    return json({ received: true });
  }

  try {
    const customerId = payload.id.toString();
    
    // Check if customer already exists
    const existingCustomer = await prisma.customer.findFirst({
      where: {
        shopId: session.shop as unknown as number,
        shopCustomerId: BigInt(payload.id)
      }
    });

    if (existingCustomer) {
      return json({ received: true, message: 'Customer already exists' });
    }

    // Create new customer
    const customer = await prisma.customer.create({
      data: {
        shopId: session.shop as unknown as number,
        shopCustomerId: BigInt(payload.id),
        email: payload.email || null,
        acceptsMarketing: payload.accepts_marketing || false,
        pointBalance: 0,
        lifetimePoints: 0,
        isActive: true,
      }
    });

    // Award welcome bonus for new signup
    await loyaltyProgram.awardWelcomeBonus(
      session.shop as unknown as number,
      customer.id
    );

    return json({ 
      received: true,
      message: 'Customer created and welcome bonus awarded',
      customerId: customer.id
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return json({ 
      received: true, 
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};
