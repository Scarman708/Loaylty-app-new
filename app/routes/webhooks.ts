// app/routes/webhooks.ts
import type { ActionFunction, LoaderFunction } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

// Reject non-POSTs (Shopify posts webhooks)
export const loader: LoaderFunction = () =>
  new Response("Method Not Allowed", { status: 405 });

export const action: ActionFunction = async ({ request }) => {
  try {
    // Verifies HMAC + parses JSON into `payload`
    const { topic, shop, payload } = await authenticate.webhook(request);

    switch (topic) {
      case "APP_UNINSTALLED":
        // TODO: clean up any shop-scoped data
        console.log(`[${topic}] from ${shop}`);
        break;

      case "ORDERS_PAID":
      case "ORDERS_FULFILLED":
      case "ORDERS_UPDATED":
      case "ORDERS_CANCELLED":
      case "REFUNDS_CREATE":
      case "CUSTOMERS_CREATE":
      case "CUSTOMERS_UPDATE":
        // TODO: implement your logic per topic
        console.log(`[${topic}] from ${shop}`);
        break;

      default:
        // Return 200 anyway so Shopify doesn't retry forever
        console.warn(`Unhandled topic: ${topic} from ${shop}`);
        break;
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    // HMAC failed or handler threw
    console.error("Webhook error:", err);
    return new Response("Unauthorized", { status: 401 });
  }
}
