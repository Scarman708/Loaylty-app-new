// app/routes/webhooks.orders.paid.ts
// Handles ORDERS_PAID webhook - converts PENDING ledger to AVAILABLE when holdEvent is PAID

import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { LedgerSource, LedgerStatus, EarnHoldEvent } from "@prisma/client";

const prisma = new PrismaClient();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  
  console.log('=== ORDERS_PAID webhook received ===');
  
  if (topic !== "ORDERS_PAID") {
    return json({ success: false, error: "Invalid topic" }, { status: 400 });
  }

  try {
    const order = payload as any;
    const shopDomain = shop.replace("https://", "").replace("/", "");
    
    console.log(`Processing paid order ${order.name || order.id} for shop ${shopDomain}`);
    
    // Find the shop in our database
    const shopData = await prisma.shop.findUnique({
      where: { shopDomain },
      include: { program: true },
    });

    if (!shopData) {
      console.error('Shop not found:', shopDomain);
      return json({ success: false, error: "Shop not found" }, { status: 404 });
    }

    if (!shopData.program) {
      console.error('Program settings not found for shop:', shopDomain);
      return json({ success: false, error: "Program settings not configured" }, { status: 404 });
    }

    // Only process if holdEvent is PAID
    if (shopData.program.holdEvent !== EarnHoldEvent.PAID) {
      console.log(`Skipping - holdEvent is ${shopData.program.holdEvent}, not PAID`);
      return json({ success: true, skipped: true, reason: 'holdEvent not PAID' }, { status: 200 });
    }

    // Extract customer ID (handle both GID and numeric formats)
    const customerId = extractId(order.customer?.id, 'Customer');

    // Extract order ID (handle both GID and numeric formats)
    const orderId = extractId(order.id, 'Order');

    console.log(`Looking for customer ID: ${customerId}, Order ID: ${orderId}`);

    // Find the customer in our database
    const customer = await prisma.customer.findFirst({
      where: {
        shopId: shopData.id,
        shopCustomerId: customerId,
      },
    });

    if (!customer) {
      console.error('Customer not found:', customerId.toString());
      return json({ success: false, error: "Customer not found" }, { status: 404 });
    }

    console.log(`Customer found: ${customer.id}`);

    // Find the pending ledger entry for this order
    const pendingLedger = await prisma.pointLedger.findFirst({
      where: {
        shopId: shopData.id,
        customerId: customer.id,
        orderId: orderId,
        status: LedgerStatus.PENDING,
        source: LedgerSource.ORDER,
      },
    });

    if (pendingLedger) {
      console.log(`Found PENDING ledger entry (ID: ${pendingLedger.id}), converting to AVAILABLE (${pendingLedger.delta} points)`);
      
      // Update existing pending ledger to AVAILABLE
      await prisma.$transaction([
        prisma.pointLedger.update({
          where: { id: pendingLedger.id },
          data: {
            status: LedgerStatus.AVAILABLE,
            availableAt: new Date(),
          },
        }),
        prisma.customer.update({
          where: { id: customer.id },
          data: {
            pointBalance: { increment: pendingLedger.delta },
            lifetimePoints: { increment: Math.max(0, pendingLedger.delta) },
            lastEarnedAt: new Date(),
          },
        }),
      ]);

      console.log(`✅ Successfully awarded ${pendingLedger.delta} points to customer ${customer.id}`);
      return json({ success: true, pointsAwarded: pendingLedger.delta });
      
    } else {
      console.log('No PENDING ledger found');
      
      // Check if points were already awarded (AVAILABLE status)
      const existingLedger = await prisma.pointLedger.findFirst({
        where: {
          shopId: shopData.id,
          customerId: customer.id,
          orderId: orderId,
          status: LedgerStatus.AVAILABLE,
          source: LedgerSource.ORDER,
        }
      });

      if (existingLedger) {
        console.log(`Points already awarded for this order (ledger ID: ${existingLedger.id})`);
        return json({ success: true, alreadyProcessed: true });
      }

      console.warn('⚠️ No ledger entry found for this order. ORDERS_CREATE webhook may have failed.');
      return json({ success: true, noLedgerFound: true });
    }

  } catch (error) {
    console.error("❌ Error processing order payment:", error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    return json({ success: false, error: "Internal server error" }, { status: 500 });
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