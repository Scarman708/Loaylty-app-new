// app/routes/webhooks.ts
// Main webhook router - receives all webhooks and routes them appropriately
// This file MUST have an action export to handle POST requests

import type { ActionFunction, LoaderFunction } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

// Reject non-POSTs (Shopify posts webhooks)
export const loader: LoaderFunction = () =>
  new Response("Method Not Allowed", { status: 405 });

// Main webhook handler - this is called for ALL webhooks
export const action: ActionFunction = async ({ request }) => {
  try {
    // Verifies HMAC + parses JSON into `payload`
    const { topic, shop, payload } = await authenticate.webhook(request);

    console.log(`[WEBHOOK] ${topic} received from ${shop}`);

    // Route to appropriate handler based on topic
    switch (topic) {
      case "APP_UNINSTALLED":
        console.log(`[${topic}] from ${shop}`);
        // TODO: clean up any shop-scoped data
        await handleAppUninstalled(shop, payload);
        break;

      case "ORDERS_CREATE":
        console.log(`[${topic}] Processing order creation`);
        return await handleOrdersCreate(shop, payload);

      case "ORDERS_FULFILLED":
        console.log(`[${topic}] Processing order fulfillment`);
        return await handleOrdersFulfilled(shop, payload);

      case "ORDERS_PAID":
        console.log(`[${topic}] Processing order payment`);
        return await handleOrdersPaid(shop, payload);

      case "ORDERS_UPDATED":
      case "ORDERS_CANCELLED":
      case "REFUNDS_CREATE":
      case "CUSTOMERS_CREATE":
      case "CUSTOMERS_UPDATE":
        console.log(`[${topic}] from ${shop} - not implemented`);
        break;

      default:
        console.warn(`Unhandled webhook topic: ${topic} from ${shop}`);
        break;
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Webhook authentication error:", err);
    return new Response("Unauthorized", { status: 401 });
  }
};

// ==================== HANDLER IMPORTS ====================
// Import the actual handler logic from separate files
import { PrismaClient } from "@prisma/client";
import { LedgerReason, LedgerSource, LedgerStatus, EarnHoldEvent } from "@prisma/client";

const db = new PrismaClient();

// ==================== APP_UNINSTALLED HANDLER ====================
async function handleAppUninstalled(shop: string, payload: any) {
  try {
    console.log(`Processing app uninstall for ${shop}`);
    // TODO: Implement cleanup logic
    // - Mark shop as uninstalled
    // - Clean up any scheduled jobs
    // - Archive data if needed
  } catch (error) {
    console.error('Error handling app uninstall:', error);
  }
}

// ==================== ORDERS_CREATE HANDLER ====================
async function handleOrdersCreate(shop: string, payload: any) {
  try {
    const order = payload;
    
    console.log(`=== ORDERS_CREATE webhook: order ${order.name || order.id} ===`);
    
    // Skip if it's a test order or if there's no customer
    if (order.test || !order.customer) {
      console.log('→ Skipped (test order or no customer)');
      return new Response(JSON.stringify({ success: true, skipped: true }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get shop from database using the shop domain
    const shopDomain = shop.replace("https://", "").replace(/\/$/, "");
    const shopRecord = await db.shop.findUnique({
      where: { shopDomain },
      include: { program: true }
    });

    if (!shopRecord) {
      console.error('→ Shop not found:', shopDomain);
      return new Response(JSON.stringify({ success: false, error: 'Shop not found' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!shopRecord.program) {
      console.error('→ Program settings not found');
      return new Response(JSON.stringify({ success: false, error: 'Program settings not configured' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check if program is active
    if (shopRecord.program.status !== 'ACTIVE') {
      console.log('→ Program not active, skipping');
      return new Response(JSON.stringify({ success: true, skipped: true }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`→ Processing order for shop: ${shopDomain} (ID: ${shopRecord.id})`);

    // Extract order ID (handle both GID and numeric formats)
    const orderId = extractId(order.id, 'Order');

    // Check if we've already processed this order
    const existingLedger = await db.pointLedger.findFirst({
      where: { 
        orderId: orderId,
        shopId: shopRecord.id,
        source: LedgerSource.ORDER
      },
    });

    if (existingLedger) {
      console.log(`→ Already processed (ledger ${existingLedger.id})`);
      return new Response(JSON.stringify({ success: true, alreadyProcessed: true }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Extract customer ID
    const customerId = extractId(order.customer?.id, 'Customer');
    console.log(`→ Looking for customer ID: ${customerId}`);

    // Find or create customer
    let customer = await db.customer.findFirst({
      where: {
        shopCustomerId: customerId,
        shopId: shopRecord.id
      }
    });

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
      console.log(`→ Created customer ${customer.id}`);
    } else if (!customer) {
      console.log('→ No customer found/created');
      return new Response(JSON.stringify({ success: true, noCustomer: true }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Calculate points
    const orderTotal = parseFloat(order.total_price || '0');
    const pointsToAward = Math.floor(orderTotal * shopRecord.program.pointsPerCurrency);

    console.log(`→ $${orderTotal} × ${shopRecord.program.pointsPerCurrency} = ${pointsToAward} points`);

    if (pointsToAward <= 0) {
      console.log('→ No points to award');
      return new Response(JSON.stringify({ success: true, noPoints: true }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Determine if points should be pending or immediate
    const holdEvent = shopRecord.program.holdEvent;
    const shouldBePending = holdEvent === EarnHoldEvent.FULFILLED;
    const status = shouldBePending ? LedgerStatus.PENDING : LedgerStatus.AVAILABLE;

    console.log(`→ holdEvent: ${holdEvent}, status: ${status}`);

    // Create ledger entry
    const ledger = await db.pointLedger.create({
      data: {
        shopId: shopRecord.id,
        customerId: customer.id,
        delta: pointsToAward,
        reason: LedgerReason.EARN,
        source: LedgerSource.ORDER,
        orderId,
        orderName: order.name || order.order_number?.toString(),
        status,
        availableAt: shouldBePending ? null : new Date(),
        metadata: {
          orderTotal: order.total_price,
          customerEmail: order.customer?.email,
          orderCreatedAt: order.created_at,
          pointsPerCurrency: shopRecord.program.pointsPerCurrency,
          calculatedPoints: pointsToAward,
          holdEvent
        },
      },
    });

    console.log(`→ Created ledger ${ledger.id} (${status})`);

    // If not pending, update customer balance immediately
    if (!shouldBePending) {
      await db.customer.update({
        where: { id: customer.id },
        data: {
          pointBalance: { increment: pointsToAward },
          lifetimePoints: { increment: pointsToAward },
          lastEarnedAt: new Date(),
        },
      });
      console.log(`→ Points awarded immediately`);
    }

    // Handle referral bonus
    if (shopRecord.program.referralsEnabled) {
      const referringCustomer = await db.customer.findFirst({
        where: {
          referredCustomers: {
            some: { id: customer.id }
          }
        }
      });

      if (referringCustomer) {
        const referralPoints = shopRecord.program.referrerBonus || Math.ceil(pointsToAward * 0.1);
        
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
              orderId,
              orderName: order.name || order.order_number?.toString(),
              status: LedgerStatus.AVAILABLE,
              availableAt: new Date(),
              metadata: {
                referredCustomerId: customer.id,
                referredOrderId: orderId.toString(),
                orderTotal: order.total_price
              },
            },
          }),
        ]);

        console.log(`→ Referral bonus: ${referralPoints} pts to customer ${referringCustomer.id}`);
      }
    }

    console.log(`✅ ORDERS_CREATE complete`);
    return new Response(JSON.stringify({ success: true, pointsAwarded: pointsToAward }), { 
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('❌ ORDERS_CREATE error:', error);
    return new Response(JSON.stringify({ success: false, error: 'Error processing webhook' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ==================== ORDERS_FULFILLED HANDLER ====================
async function handleOrdersFulfilled(shop: string, payload: any) {
  try {
    const order = payload;
    
    console.log(`=== ORDERS_FULFILLED webhook: order ${order.name || order.id} ===`);
    
    const shopDomain = shop.replace("https://", "").replace(/\/$/, "");
    const shopRecord = await db.shop.findUnique({
      where: { shopDomain },
      include: { program: true },
    });

    if (!shopRecord?.program) {
      console.error('→ Shop or settings not found');
      return new Response(JSON.stringify({ success: false, error: 'Shop not found' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Only process if holdEvent is FULFILLED
    if (shopRecord.program.holdEvent !== EarnHoldEvent.FULFILLED) {
      console.log(`→ Skipped (holdEvent is ${shopRecord.program.holdEvent})`);
      return new Response(JSON.stringify({ success: true, skipped: true }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Extract IDs
    const orderId = extractId(order.id, 'Order');
    const customerId = extractId(order.customer?.id, 'Customer');

    // Find customer
    const customer = await db.customer.findFirst({
      where: {
        shopId: shopRecord.id,
        shopCustomerId: customerId,
      },
    });

    if (!customer) {
      console.error('→ Customer not found:', customerId.toString());
      return new Response(JSON.stringify({ success: false, error: 'Customer not found' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Find PENDING ledger entry
    const pendingLedger = await db.pointLedger.findFirst({
      where: {
        shopId: shopRecord.id,
        customerId: customer.id,
        orderId,
        status: LedgerStatus.PENDING,
        source: LedgerSource.ORDER,
      },
    });

    if (pendingLedger) {
      console.log(`→ Found PENDING ledger ${pendingLedger.id} (${pendingLedger.delta} pts)`);
      
      // Convert to AVAILABLE
      await db.$transaction([
        db.pointLedger.update({
          where: { id: pendingLedger.id },
          data: {
            status: LedgerStatus.AVAILABLE,
            availableAt: new Date(),
          },
        }),
        db.customer.update({
          where: { id: customer.id },
          data: {
            pointBalance: { increment: pendingLedger.delta },
            lifetimePoints: { increment: pendingLedger.delta },
            lastEarnedAt: new Date(),
          },
        }),
      ]);

      console.log(`✅ Awarded ${pendingLedger.delta} points to customer ${customer.id}`);
      return new Response(JSON.stringify({ success: true, pointsAwarded: pendingLedger.delta }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      // Check if already processed
      const existingLedger = await db.pointLedger.findFirst({
        where: {
          shopId: shopRecord.id,
          customerId: customer.id,
          orderId,
          status: LedgerStatus.AVAILABLE,
          source: LedgerSource.ORDER,
        }
      });

      if (existingLedger) {
        console.log('→ Already processed');
        return new Response(JSON.stringify({ success: true, alreadyProcessed: true }), { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      console.warn('⚠️ No ledger found - ORDERS_CREATE may have failed');
      // Fallback
      const pointsAwarded = await createPointsFallback(shopRecord, customer, order, orderId);
      return new Response(JSON.stringify({ success: true, fallbackUsed: true, pointsAwarded }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error("❌ ORDERS_FULFILLED error:", error);
    return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ==================== ORDERS_PAID HANDLER ====================
async function handleOrdersPaid(shop: string, payload: any) {
  try {
    const order = payload;
    
    console.log(`=== ORDERS_PAID webhook: order ${order.name || order.id} ===`);
    
    const shopDomain = shop.replace("https://", "").replace(/\/$/, "");
    const shopRecord = await db.shop.findUnique({
      where: { shopDomain },
      include: { program: true },
    });

    if (!shopRecord?.program) {
      console.error('→ Shop or settings not found');
      return new Response(JSON.stringify({ success: false, error: 'Shop not found' }), { 
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Only process if holdEvent is PAID
    if (shopRecord.program.holdEvent !== EarnHoldEvent.PAID) {
      console.log(`→ Skipped (holdEvent is ${shopRecord.program.holdEvent})`);
      return new Response(JSON.stringify({ success: true, skipped: true }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Extract IDs
    const orderId = extractId(order.id, 'Order');
    const customerId = extractId(order.customer?.id, 'Customer');

    // Find customer
    const customer = await db.customer.findFirst({
      where: {
        shopId: shopRecord.id,
        shopCustomerId: customerId,
      },
    });

    if (!customer) {
      console.log('→ Customer not found');
      return new Response(JSON.stringify({ success: true, noCustomer: true }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Find PENDING ledger entry
    const pendingLedger = await db.pointLedger.findFirst({
      where: {
        shopId: shopRecord.id,
        customerId: customer.id,
        orderId,
        status: LedgerStatus.PENDING,
        source: LedgerSource.ORDER,
      },
    });

    if (pendingLedger) {
      console.log(`→ Found PENDING ledger ${pendingLedger.id} (${pendingLedger.delta} pts)`);
      
      // Convert to AVAILABLE
      await db.$transaction([
        db.pointLedger.update({
          where: { id: pendingLedger.id },
          data: {
            status: LedgerStatus.AVAILABLE,
            availableAt: new Date(),
          },
        }),
        db.customer.update({
          where: { id: customer.id },
          data: {
            pointBalance: { increment: pendingLedger.delta },
            lifetimePoints: { increment: pendingLedger.delta },
            lastEarnedAt: new Date(),
          },
        }),
      ]);

      console.log(`✅ Awarded ${pendingLedger.delta} points to customer ${customer.id}`);
      return new Response(JSON.stringify({ success: true, pointsAwarded: pendingLedger.delta }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    } else {
      console.log('→ No PENDING ledger found');
      return new Response(JSON.stringify({ success: true, noPendingLedger: true }), { 
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error("❌ ORDERS_PAID error:", error);
    return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ==================== HELPER FUNCTIONS ====================

function extractId(id: any, type: string): bigint {
  if (!id) return BigInt(0);
  const idString = id.toString();
  if (idString.includes('gid://')) {
    return BigInt(idString.replace(`gid://shopify/${type}/`, ""));
  }
  return BigInt(id);
}

async function createPointsFallback(shop: any, customer: any, order: any, orderId: bigint): Promise<number> {
  console.log('→ FALLBACK: Creating points');
  
  const orderTotal = parseFloat(order.total_price || '0');
  const pointsToAward = Math.floor(orderTotal * shop.program.pointsPerCurrency);

  if (pointsToAward <= 0) {
    console.log('→ FALLBACK: No points to award');
    return 0;
  }

  await db.$transaction([
    db.pointLedger.create({
      data: {
        shopId: shop.id,
        customerId: customer.id,
        delta: pointsToAward,
        reason: LedgerReason.EARN,
        source: LedgerSource.ORDER,
        status: LedgerStatus.AVAILABLE,
        orderId,
        orderName: order.name || order.order_number?.toString(),
        availableAt: new Date(),
        metadata: {
          orderTotal: order.total_price,
          pointsPerCurrency: shop.program.pointsPerCurrency,
          calculatedPoints: pointsToAward,
          createdByFallback: true
        },
      },
    }),
    db.customer.update({
      where: { id: customer.id },
      data: {
        pointBalance: { increment: pointsToAward },
        lifetimePoints: { increment: pointsToAward },
        lastEarnedAt: new Date(),
      },
    }),
  ]);

  console.log(`→ FALLBACK: Awarded ${pointsToAward} points`);
  return pointsToAward;
}