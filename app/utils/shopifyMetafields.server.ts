// app/utils/shopifyMetafields.server.ts
import { LATEST_API_VERSION } from "@shopify/shopify-api";
import  prisma  from "~/db.server";

// Define the metafields we want to create
const CUSTOMER_METAFIELDS = [
  {
    namespace: "loyalty",
    key: "points_balance",
    name: "Points Balance",
    type: "number_integer",
    description: "Current loyalty points balance"
  },
  {
    namespace: "loyalty",
    key: "lifetime_points",
    name: "Lifetime Points",
    type: "number_integer",
    description: "Total lifetime loyalty points earned"
  },
  {
    namespace: "loyalty",
    key: "tier",
    name: "Loyalty Tier",
    type: "single_line_text_field",
    description: "Current loyalty tier"
  }
];

export async function setupLoyaltyMetafields(shopDomain: string) {
  try {
    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { accessToken: true }
    });

    if (!shop?.accessToken) {
      console.error("No access token found for shop:", shopDomain);
      return false;
    }

    // Create each metafield definition
    for (const metafield of CUSTOMER_METAFIELDS) {
      const response = await fetch(
        `https://${shopDomain}/admin/api/${LATEST_API_VERSION}/metafield_definitions.json`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': shop.accessToken,
          },
          body: JSON.stringify({
            metafield_definition: {
              ...metafield,
              owner_type: "CUSTOMER",
              visible: true
            }
          })
        }
      );

      if (!response.ok) {
        const error = await response.text();
        console.error(`Failed to create metafield ${metafield.key}:`, error);
        continue;
      }

      console.log(`✅ Created metafield: ${metafield.namespace}.${metafield.key}`);
    }

    return true;
  } catch (error) {
    console.error("Error setting up metafields:", error);
    return false;
  }
}