// app/routes/webhooks.orders.create.ts
// Handles ORDERS_CREATE webhook - creates PENDING or AVAILABLE ledger entries

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { LedgerReason, LedgerSource, LedgerStatus, EarnHoldEvent } from "@prisma/client";

const db = new PrismaClient();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  
  if (topic !== "ORDERS_CREATE") {
    return json({ success: false, error: "Invalid topic" }, { status: 400 });
  }

  try {
    const order = payload as any;
    
    console.log(`=== ORDERS_CREATE webhook received for order ${order.name || order.id} ===`);
    
    // Skip if it's a test order or if there's no customer
    if (order.test || !order.customer) {
      console.log('Skipping test order or order without customer');
      return json({ success: true, skipped: true }, { status: 200 });
    }

    // Get shop from database using the shop domain
    const shopDomain = shop.replace("https://", "").replace("/", "");
    const shopRecord = await db.shop.findUnique({
      where: { shopDomain },
      include: { program: true }
    });

    if (!shopRecord) {
      console.error('Shop not found in database:', shopDomain);
      return json({ success: false, error: 'Shop not found' }, { status: 404 });
    }

    if (!shopRecord.program) {
      console.error('Program settings not found for shop:', shopDomain);
      return json({ success: false, error: 'Program settings not configured' }, { status: 404 });
    }

    // Check if program is active
    if (shopRecord.program.status !== 'ACTIVE') {
      console.log('Program not active, skipping point calculation');
      return json({ success: true, skipped: true }, { status: 200 });
    }

    console.log(`Processing order for shop: ${shopDomain} (ID: ${shopRecord.id})`);

    // Extract order ID (handle both GID and numeric formats)
    const orderId = extractId(order.id, 'Order');

    // FIX: Check if we've already processed this order (with SOURCE filter to avoid matching referrals)
    const existingLedger = await db.pointLedger.findFirst({
      where: { 
        orderId: orderId,
        shopId: shopRecord.id,
        source: LedgerSource.ORDER // FIX: Added source filter
      },
    });

    if (existingLedger) {
      console.log(`Order ${orderId} already processed for points (ledger ID: ${existingLedger.id})`);
      return json({ success: true, alreadyProcessed: true }, { status: 200 });
    }

    // Extract customer ID (handle both GID and numeric formats)
    const customerId = extractId(order.customer?.id, 'Customer');

    console.log(`Looking for customer ID: ${customerId}`);

    // Find or create the customer in our database
    let customer = await db.customer.findFirst({
      where: {
        shopCustomerId: customerId,
        shopId: shopRecord.id
      }
    });

    // If customer doesn't exist, create them
    if (!customer && order.customer) {
      customer = await db.customer.create({
        data: {
          shopId: shopRecord.id,
          shopCustomerId: customerId,
          email: order.customer.email || null,
          acceptsMarketing: order.customer.accepts_marketing || false,
          pointBalance: 0,
          lifetimePoints: 0
        }
      });
      console.log(`Created new customer record: ${customer.id}`);
    } else if (!customer) {
      console.log('No customer information available for order:', order.id);
      return json({ success: true, noCustomer: true }, { status: 200 });
    }

    // FIX: Calculate points using program (CONSISTENT with ORDERS_FULFILLED)
    const orderTotal = parseFloat(order.total_price || '0');
    const pointsToAward = Math.floor(orderTotal * shopRecord.program.pointsPerCurrency);

    console.log(`Order total: $${orderTotal}, Points to award: ${pointsToAward} (rate: ${shopRecord.program.pointsPerCurrency})`);

    if (pointsToAward <= 0) {
      console.log('No points to award for order:', order.id);
      return json({ success: true, noPoints: true }, { status: 200 });
    }

    // FIX: Determine if points should be PENDING or AVAILABLE based on holdEvent
    const holdEvent = shopRecord.program.holdEvent;
    const shouldBePending = holdEvent === EarnHoldEvent.FULFILLED;
    const status = shouldBePending ? LedgerStatus.PENDING : LedgerStatus.AVAILABLE;

    console.log(`Hold event: ${holdEvent}, Status: ${status}`);

    // Create ledger entry
    const ledger = await db.pointLedger.create({
      data: {
        shopId: shopRecord.id,
        customerId: customer.id,
        delta: pointsToAward,
        reason: LedgerReason.EARN,
        source: LedgerSource.ORDER,
        orderId: orderId,
        orderName: order.name || order.order_number?.toString(),
        status: status,
        availableAt: shouldBePending ? null : new Date(), // Only set if immediately available
        metadata: {
          orderTotal: order.total_price,
          customerEmail: order.customer?.email,
          orderCreatedAt: order.created_at,
          pointsPerCurrency: shopRecord.program.pointsPerCurrency,
          calculatedPoints: pointsToAward,
          holdEvent: holdEvent
        },
      },
    });

    console.log(`✅ Created ${status} ledger entry (ID: ${ledger.id}) for ${pointsToAward} points`);

    // FIX: If not pending, update customer balance immediately
    if (!shouldBePending) {
      await db.customer.update({
        where: { id: customer.id },
        data: {
          pointBalance: { increment: pointsToAward },
          lifetimePoints: { increment: pointsToAward },
          lastEarnedAt: new Date(),
        },
      });
      console.log(`✅ Updated customer balance immediately (holdEvent: ${holdEvent})`);
    }

    // Handle referral bonus
    if (shopRecord.program.referralsEnabled) {
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
        // FIX: Use configured referrerBonus if available, otherwise default to 10%
        const referralPoints = shopRecord.program.referrerBonus 
          ? shopRecord.program.referrerBonus 
          : Math.ceil(pointsToAward * 0.1);
        
        await db.$transaction([
          db.customer.update({
            where: { id: referringCustomer.id },
            data: {
              pointBalance: { increment: referralPoints },
              lifetimePoints: { increment: referralPoints },
            },
          }),
          db.pointLedger.create({
            data: {
              shopId: shopRecord.id,
              customerId: referringCustomer.id,
              delta: referralPoints,
              reason: LedgerReason.REFERRAL_BONUS,
              source: LedgerSource.REFERRAL,
              orderId: orderId,
              orderName: order.name || order.order_number?.toString(),
              status: LedgerStatus.AVAILABLE,
              availableAt: new Date(),
              metadata: {
                referredCustomerId: customer.id,
                referredOrderId: orderId.toString(),
                orderTotal: order.total_price,
                referralPoints: referralPoints
              },
            },
          }),
        ]);

        console.log(`✅ Awarded ${referralPoints} referral points to customer ${referringCustomer.id}`);
      }
    }

    return json({ success: true, pointsAwarded: pointsToAward, status });
  } catch (error) {
    console.error('❌ Error processing ORDERS_CREATE webhook:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    return json({ success: false, error: 'Error processing webhook' }, { status: 500 });
  }
};

// Helper function to extract numeric ID from GID format or plain number
function extractId(id: any, type: string): bigint {
  if (!id) return BigInt(0);
  const idString = id.toString();
  if (idString.includes('gid://')) {
    return BigInt(idString.replace(`gid://shopify/${type}/`, ""));
  }
  return BigInt(id);
}