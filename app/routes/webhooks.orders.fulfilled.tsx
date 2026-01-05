import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { LedgerReason, LedgerSource, LedgerStatus } from "@prisma/client";

const prisma = new PrismaClient();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  
  if (topic !== "ORDERS_FULFILLED") {
    return json({ success: false, error: "Invalid topic" }, { status: 400 });
  }

  try {
    const order = payload as any;
    const shopDomain = shop.replace("https://", "").replace("/", "");
    
    // Find the shop in our database
    const shopData = await prisma.shop.findUnique({
      where: { shopDomain },
      include: { program: true },
    });

    if (!shopData) {
      return json({ success: false, error: "Shop not found" }, { status: 404 });
    }

    // Find the customer in our database
    const customer = await prisma.customer.findFirst({
      where: {
        shopId: shopData.id,
        shopCustomerId: BigInt(order.customer?.id.replace("gid://shopify/Customer/", "")),
      },
    });

    if (!customer) {
      return json({ success: false, error: "Customer not found" }, { status: 404 });
    }

    // Find the pending ledger entry for this order
    const pendingLedger = await prisma.pointLedger.findFirst({
      where: {
        shopId: shopData.id,
        customerId: customer.id,
        orderId: BigInt(order.id.replace("gid://shopify/Order/", "")),
        status: 'PENDING',
      },
    });

    if (pendingLedger) {
      // Update existing pending ledger to AVAILABLE
      await prisma.$transaction([
        prisma.pointLedger.update({
          where: { id: pendingLedger.id },
          data: {
            status: 'AVAILABLE',
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
    } else {
      // If no pending ledger found, it might be a new order that we need to process
      await processOrderForPoints(shopData, customer, order);
    }

    return json({ success: true });
  } catch (error) {
    console.error("Error processing order fulfillment:", error);
    return json({ success: false, error: "Internal server error" }, { status: 500 });
  }
};

async function processOrderForPoints(shop: any, customer: any, order: any) {
  // Get point rules for this shop
  const pointRules = await prisma.pointRule.findMany({
    where: {
      shopId: shop.id,
      isActive: true,
    },
    orderBy: { sortOrder: 'asc' },
  });

  // Find the first active rule (assuming there's only one active rule for purchases)
  const activeRule = pointRules[0];
  
  if (!activeRule) {
    throw new Error("No active point rules found");
  }

  // Calculate points based on order total
  const orderTotal = parseFloat(order.total_price);
  const points = Math.floor(orderTotal * activeRule.points);

  if (points <= 0) {
    console.log('No points to award for order:', order.id);
    return;
  }

  // Create ledger entry
  await prisma.$transaction([
    prisma.pointLedger.create({
      data: {
        shopId: shop.id,
        customerId: customer.id,
        delta: points,
        reason: 'EARN',
        source: 'ORDER',
        status: 'AVAILABLE',
        orderId: BigInt(order.id.replace("gid://shopify/Order/", "")),
        orderName: order.name,
        availableAt: new Date(),
        metadata: {
          orderTotal: order.total_price,
          customerEmail: order.customer?.email,
          orderCreatedAt: order.created_at,
          pointsPerDollar: activeRule.points,
          calculatedPoints: points
        },
      },
    }),
    prisma.customer.update({
      where: { id: customer.id },
      data: {
        pointBalance: { increment: points },
        lifetimePoints: { increment: points },
        lastEarnedAt: new Date(),
      },
    }),
  ]);
}