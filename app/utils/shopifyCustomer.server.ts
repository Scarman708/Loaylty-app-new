// app/utils/shopifyCustomer.server.ts
import { LATEST_API_VERSION } from "@shopify/shopify-api";
import prisma from "~/db.server";

// Helper function to safely serialize BigInt
function safeStringify(obj: any) {
  return JSON.stringify(obj, (key, value) => 
    typeof value === 'bigint' ? value.toString() : value
  );
}

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

    // Convert BigInt to string for the request body
    const customerData = {
      customer: {
        id: customer.shopCustomerId.toString(), // Convert BigInt to string
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
    };

    // Update customer metafields in Shopify
    const response = await fetch(
      `https://${shopDomain}/admin/api/${LATEST_API_VERSION}/customers/${customer.shopCustomerId}.json`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': shop.accessToken,
        },
        body: safeStringify(customerData) // Use our safe stringify function
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