// app/utils/shopifyCustomer.server.ts
import { authenticate } from "~/shopify.server";
import  prisma  from "~/db.server";
import { LATEST_API_VERSION } from "@shopify/shopify-api";

export async function syncCustomerToShopify(shopDomain: string, customerId: string) {
  try {
    // Get the shop's access token
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { accessToken: true }
    });

    if (!shop?.accessToken) {
      console.error("No access token found for shop:", shopDomain);
      return false;
    }

    // Get customer data from our database
    const customer = await prisma.customer.findUnique({
      where: { id: parseInt(customerId) },
      include: { currentTier: true }
    });

    if (!customer) {
      console.error("Customer not found:", customerId);
      return false;
    }

    // Update customer metafields in Shopify
    const response = await fetch(
      `https://${shopDomain}/admin/api/${LATEST_API_VERSION}/customers/${customer.shopCustomerId}.json`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': shop.accessToken,
        },
        body: JSON.stringify({
          customer: {
            id: customer.shopCustomerId,
            metafields: [
              {
                namespace: "loyalty",
                key: "points_balance",
                value: customer.pointBalance.toString(),
                type: "number_integer"
              },
              {
                namespace: "loyalty",
                key: "lifetime_points",
                value: customer.lifetimePoints.toString(),
                type: "number_integer"
              },
              {
                namespace: "loyalty",
                key: "tier",
                value: customer.currentTier?.name || 'Member',
                type: "single_line_text_field"
              }
            ]
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Failed to update customer in Shopify:", error);
      return false;
    }

    console.log("Successfully synced customer to Shopify:", customerId);
    return true;
  } catch (error) {
    console.error("Error syncing customer to Shopify:", error);
    return false;
  }
}