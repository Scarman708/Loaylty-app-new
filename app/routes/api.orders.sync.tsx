// Create a new file: app/routes/api.orders.sync.tsx
import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { PrismaClient } from "@prisma/client";
import { LedgerStatus } from "@prisma/client";

const prisma = new PrismaClient();

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin,session } = await authenticate.admin(request);
  const { orderId } = await request.json();

  if (!orderId) {
    return json({ success: false, error: "Order ID is required" }, { status: 400 });
  }

  try {
    // Get the order from Shopify
    const orderResponse = await admin.graphql(
      `#graphql
        query GetOrder($id: ID!) {
          order(id: $id) {
            id
            name
            customer {
              id
              email
            }
            totalPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            displayFulfillmentStatus
            createdAt
          }
        }
      `,
      {
        variables: {
          id: `gid://shopify/Order/${orderId}`
        }
      }
    );

    const orderData = await orderResponse.json();
    const order = orderData.data?.order;

    if (!order) {
      return json({ success: false, error: "Order not found" }, { status: 404 });
    }

    // Find the shop
   const shop = await prisma.shop.findFirst({
  where: { shopDomain: session.shop },
});

    if (!shop) {
      return json({ success: false, error: "Shop not found" }, { status: 404 });
    }

    // Find or create customer
    const customerId = order.customer?.id?.replace('gid://shopify/Customer/', '');
    if (!customerId) {
      return json({ success: false, error: "No customer associated with order" }, { status: 400 });
    }

    let customer = await prisma.customer.findFirst({
      where: {
        shopId: shop.id,
        shopCustomerId: BigInt(customerId)
      }
    });

    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          shopId: shop.id,
          shopCustomerId: BigInt(customerId),
          email: order.customer?.email || null,
          pointBalance: 0,
          lifetimePoints: 0
        }
      });
    }

    // Process the order for points
    await processOrderForPoints(shop, customer, order, BigInt(orderId));

    return json({ success: true, message: "Order synced successfully" });
  } catch (error) {
    console.error('Error syncing order:', error);
    return json({ success: false, error: "Failed to sync order" }, { status: 500 });
  }
};

// Reuse the processOrderForPoints function from webhooks.orders.fulfilled.tsx
async function processOrderForPoints(shop: any, customer: any, order: any, orderId: bigint) {
  // ... implementation from previous step ...
}