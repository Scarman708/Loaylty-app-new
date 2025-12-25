import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { LedgerReason, LedgerSource } from "@prisma/client";


// This webhook is triggered when a new order is created in the store
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  
  try {
    const order = payload as any;
    
    // Skip if it's a test order or if there's no customer
    if (order.test || !order.customer) {
      console.log('Skipping test order or order without customer');
      return new Response(null, { status: 200 });
    }

    console.log(`Processing order ${order.id} from ${shop}`);

    // Check if we've already processed this order
    const existingLedger = await db.pointLedger.findFirst({
      where: { 
        orderId: order.id.toString(),
        reason: LedgerReason.EARN
      },
    });

    if (existingLedger) {
      console.log(`Order ${order.id} already processed for points`);
      return new Response(null, { status: 200 });
    }

    // Find or create the customer in our database
    let customer = await db.customer.findFirst({
      where: {
        shopCustomerId: order.customer?.id ? BigInt(order.customer.id) : undefined,
        shopId: parseInt(order.shop_id)
      }
    });

    // If customer doesn't exist, create them
    if (!customer && order.customer) {
      customer = await db.customer.create({
        data: {
          shopId: parseInt(order.shop_id),
          shopCustomerId: order.customer.id ? BigInt(order.customer.id) : undefined,
          email: order.customer.email || null,
          acceptsMarketing: order.customer.accepts_marketing || false,
          pointBalance: 0,
          lifetimePoints: 0
        }
      });
      console.log(`Created new customer record: ${customer.id}`);
    } else if (!customer) {
      console.log('No customer information available for order:', order.id);
      return new Response(null, { status: 200 });
    }

    // Calculate points based on order total (1$ = 1 point)
    const orderTotal = parseFloat(order.total_price || '0');
    const pointsToAward = Math.floor(orderTotal);

    if (pointsToAward <= 0) {
      console.log('No points to award for order:', order.id);
      return new Response(null, { status: 200 });
    }

    // First, update the customer's balance
    await db.customer.update({
      where: { id: customer.id },
      data: {
        pointBalance: { increment: pointsToAward },
        lifetimePoints: { increment: pointsToAward },
        lastEarnedAt: new Date()
      }
    });

    // Then create a ledger entry
    await db.pointLedger.create({
      data: {
        shopId: parseInt(order.shop_id),
        customerId: customer.id,
        delta: pointsToAward,
        reason: LedgerReason.EARN,
        source: LedgerSource.ORDER,
        orderId: order.id.toString(),
        orderName: order.name,
        status: 'AVAILABLE',
        availableAt: new Date(),
        metadata: {
          orderTotal: order.total_price,
          customerEmail: order.customer?.email,
          orderCreatedAt: order.created_at
        },
      },
    });

    // Check if this customer was referred by someone
    const referringCustomer = await db.customer.findFirst({
      where: {
        referredCustomers: {
          some: {
            id: customer.id
          }
        }
      }
    });

    // If there's a referring customer, award them points
    if (referringCustomer) {
      // Award 10% of the points to the referring customer (or adjust the percentage as needed)
      const referralPoints = Math.ceil(pointsToAward * 0.1);
      
      await db.customer.update({
        where: { id: referringCustomer.id },
        data: {
          pointBalance: {
            increment: referralPoints,
          },
          lifetimePoints: {
            increment: referralPoints,
          },
        },
      });

      console.log(`✅ Awarded ${referralPoints} referral points to customer ${referringCustomer.id} for referring order ${order.id}`);
      
      // Create a ledger entry for the referral bonus
      await db.pointLedger.create({
        data: {
          shopId: parseInt(order.shop_id),
          customerId: referringCustomer.id,
          delta: referralPoints,
          reason: LedgerReason.REFERRAL_BONUS, // Make sure this enum value exists in your schema
          source: LedgerSource.REFERRAL,
          orderId: order.id.toString(),
          orderName: order.name,
          status: 'AVAILABLE',
          availableAt: new Date(),
          metadata: {
            referredCustomerId: customer.id,
            referredOrderId: order.id,
            orderTotal: order.total_price
          },
        },
      });
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error('❌ Error processing order webhook:', error);
    return new Response('Error processing webhook', { status: 500 });
  }
};
