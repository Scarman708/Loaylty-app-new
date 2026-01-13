import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { PrismaClient } from "@prisma/client";
import { LedgerReason, LedgerSource, LedgerStatus } from "@prisma/client";

const db = new PrismaClient();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  
  try {
    const order = payload as any;
    
    console.log(`=== ORDERS_CREATE webhook received for order ${order.name || order.id} ===`);
    
    // Skip if it's a test order or if there's no customer
    if (order.test || !order.customer) {
      console.log('Skipping test order or order without customer');
      return new Response(null, { status: 200 });
    }

    // Get shop from database using the shop domain
    const shopDomain = shop.replace("https://", "").replace("/", "");
    const shopRecord = await db.shop.findUnique({
      where: { shopDomain },
    });

    if (!shopRecord) {
      console.error('Shop not found in database:', shopDomain);
      return new Response('Shop not found', { status: 404 });
    }

    console.log(`Processing order for shop: ${shopDomain} (ID: ${shopRecord.id})`);

    // Extract order ID (handle both formats)
    const orderIdString = order.id?.toString() || '';
    const orderId = orderIdString.includes('gid://') 
      ? BigInt(orderIdString.replace("gid://shopify/Order/", ""))
      : BigInt(order.id || 0);

    // Check if we've already processed this order
    const existingLedger = await db.pointLedger.findFirst({
      where: { 
        orderId: orderId,
        shopId: shopRecord.id,
        reason: LedgerReason.EARN
      },
    });

    if (existingLedger) {
      console.log(`Order ${orderId} already processed for points`);
      return new Response(null, { status: 200 });
    }

    // Extract customer ID (handle both formats)
    const customerIdString = order.customer?.id?.toString() || '';
    const customerId = customerIdString.includes('gid://') 
      ? BigInt(customerIdString.replace("gid://shopify/Customer/", ""))
      : BigInt(order.customer?.id || 0);

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
      return new Response(null, { status: 200 });
    }

    // Get point rules for this shop
    const pointRules = await db.pointRule.findMany({
      where: {
        shopId: shopRecord.id,
        isActive: true,
      },
      orderBy: { sortOrder: 'asc' },
    });

    // Find the purchase rule
    const purchaseRule = pointRules.find(rule => rule.isActive);
    
    if (!purchaseRule) {
      console.log('No active point rules found');
      return new Response(null, { status: 200 });
    }

    // Calculate points based on order total
    const orderTotal = parseFloat(order.total_price || '0');
    const pointsToAward = Math.floor(orderTotal * purchaseRule.points);

    console.log(`Order total: $${orderTotal}, Points to award: ${pointsToAward} (rate: ${purchaseRule.points})`);

    if (pointsToAward <= 0) {
      console.log('No points to award for order:', order.id);
      return new Response(null, { status: 200 });
    }

    // Create a pending ledger entry
    await db.pointLedger.create({
      data: {
        shopId: shopRecord.id,
        customerId: customer.id,
        delta: pointsToAward,
        reason: LedgerReason.EARN,
        source: LedgerSource.ORDER,
        orderId: orderId,
        orderName: order.name || order.order_number?.toString(),
        status: LedgerStatus.PENDING,
        metadata: {
          orderTotal: order.total_price,
          customerEmail: order.customer?.email,
          orderCreatedAt: order.created_at,
          pointsPerDollar: purchaseRule.points,
          calculatedPoints: pointsToAward
        },
      },
    });

    console.log(`✅ Created PENDING ledger entry for ${pointsToAward} points`);

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
      const referralPoints = Math.ceil(pointsToAward * 0.1);
      
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
              orderTotal: order.total_price
            },
          },
        }),
      ]);

      console.log(`✅ Awarded ${referralPoints} referral points to customer ${referringCustomer.id}`);
    }

    return new Response(null, { status: 200 });
  } catch (error) {
    console.error('❌ Error processing order webhook:', error);
    return new Response('Error processing webhook', { status: 500 });
  }
};