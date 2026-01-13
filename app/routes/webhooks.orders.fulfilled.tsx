import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { LedgerReason, LedgerSource, LedgerStatus } from "@prisma/client";

const prisma = new PrismaClient();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  
  console.log('=== ORDERS_FULFILLED webhook received ===');
  
  if (topic !== "ORDERS_FULFILLED") {
    return json({ success: false, error: "Invalid topic" }, { status: 400 });
  }

  try {
    const order = payload as any;
    const shopDomain = shop.replace("https://", "").replace("/", "");
    
    console.log(`Processing fulfilled order ${order.name || order.id} for shop ${shopDomain}`);
    
    // Find the shop in our database
    const shopData = await prisma.shop.findUnique({
      where: { shopDomain },
      include: { program: true },
    });

    if (!shopData) {
      console.error('Shop not found:', shopDomain);
      return json({ success: false, error: "Shop not found" }, { status: 404 });
    }

    // Extract customer ID (handle both formats)
    const customerIdString = order.customer?.id?.toString() || '';
    const customerId = customerIdString.includes('gid://') 
      ? BigInt(customerIdString.replace("gid://shopify/Customer/", ""))
      : BigInt(order.customer?.id || 0);

    // Extract order ID (handle both formats)
    const orderIdString = order.id?.toString() || '';
    const orderId = orderIdString.includes('gid://') 
      ? BigInt(orderIdString.replace("gid://shopify/Order/", ""))
      : BigInt(order.id || 0);

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
        status: LedgerStatus.PENDING, // FIX: Use enum instead of string
      },
    });

    if (pendingLedger) {
      console.log(`Found PENDING ledger entry, converting to AVAILABLE (${pendingLedger.delta} points)`);
      
      // Update existing pending ledger to AVAILABLE
      await prisma.$transaction([
        prisma.pointLedger.update({
          where: { id: pendingLedger.id },
          data: {
            status: LedgerStatus.AVAILABLE, // FIX: Use enum instead of string
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
    } else {
      console.log('No PENDING ledger found, processing order for points directly');
      
      // If no pending ledger found, it might be a new order that we need to process
      await processOrderForPoints(shopData, customer, order, orderId);
    }

    return json({ success: true });
  } catch (error) {
    console.error("❌ Error processing order fulfillment:", error);
    return json({ success: false, error: "Internal server error" }, { status: 500 });
  }
};

async function processOrderForPoints(shop: any, customer: any, order: any, orderId: bigint) {
  console.log('Processing order for points (no pending ledger found)');
  
  // Get program settings
  const programSettings = await prisma.programSettings.findUnique({
    where: { shopId: shop.id }
  });

  if (!programSettings) {
    console.error('No program settings found for shop');
    throw new Error("No program settings found");
  }

  // Check if points were already awarded
  const existingLedger = await prisma.pointLedger.findFirst({
    where: {
      shopId: shop.id,
      customerId: customer.id,
      orderId: orderId,
      status: { in: [LedgerStatus.AVAILABLE, LedgerStatus.PENDING] }
    }
  });

  if (existingLedger) {
    console.log('Points already processed for this order');
    return;
  }

  // Calculate points based on order total
  const orderTotal = parseFloat(order.total_price || '0');
  const pointsToAward = Math.floor(orderTotal * programSettings.pointsPerCurrency);

  console.log(`Calculating points: $${orderTotal} * ${programSettings.pointsPerCurrency} = ${pointsToAward} points`);

  if (pointsToAward <= 0) {
    console.log('No points to award for order:', order.id);
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Create the ledger entry
      await tx.pointLedger.create({
        data: {
          shopId: shop.id,
          customerId: customer.id,
          delta: pointsToAward,
          reason: LedgerReason.EARN,
          source: LedgerSource.ORDER,
          status: LedgerStatus.AVAILABLE,
          orderId: orderId,
          orderName: order.name || order.order_number?.toString(),
          availableAt: new Date(),
          metadata: {
            orderTotal: order.total_price,
            customerEmail: order.customer?.email,
            orderCreatedAt: order.created_at,
            pointsPerDollar: programSettings.pointsPerCurrency,
            calculatedPoints: pointsToAward,
            orderStatus: 'fulfilled'
          },
        },
      });

      // Update customer's points
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          pointBalance: { increment: pointsToAward },
          lifetimePoints: { increment: pointsToAward },
          lastEarnedAt: new Date(),
        },
      });

      console.log(`✅ Successfully awarded ${pointsToAward} points for order ${orderId}`);
    });
  } catch (error) {
    console.error('❌ Error processing order points:', error);
    throw error;
  }
}
