// app/shopify.server.ts
import '@shopify/shopify-app-remix/server/adapters/node';
import {
  shopifyApp,
  DeliveryMethod,
  LATEST_API_VERSION,
  ApiVersion,
} from '@shopify/shopify-app-remix/server';

import { PrismaSessionStorage } from '@shopify/shopify-app-session-storage-prisma';
import prisma from '~/db.server';

console.log('🔧 Shopify Config:', {
  apiKey: process.env.SHOPIFY_API_KEY,
  appUrl: process.env.SHOPIFY_APP_URL,
  hasSecret: !!process.env.SHOPIFY_API_SECRET,
  nodeEnv: process.env.NODE_ENV,
});
export const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  appUrl: process.env.SHOPIFY_APP_URL!,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  authPathPrefix: '/auth',
  useOnlineTokens: false,

   future: {
    unstable_newEmbeddedAuthStrategy: true,
  },

  scopes: (process.env.SCOPES ??
    'read_orders,write_orders,read_customers,write_customers,write_content')
    .split(',')
    .map(s => s.trim()),

  sessionStorage: new PrismaSessionStorage(prisma as any),

  webhooks: {

    APP_UNINSTALLED: { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
    ORDERS_PAID: { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
    ORDERS_FULFILLED: { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
    ORDERS_UPDATED: { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
    ORDERS_CANCELLED: { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
    REFUNDS_CREATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
    CUSTOMERS_CREATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
    CUSTOMERS_UPDATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
  },

  hooks: {
    afterAuth: async ({ session, admin }) => {
      console.log("🔥 afterAuth FIRED for", session.shop);
  try {
    // 1️⃣ Register webhooks
    await shopify.registerWebhooks({ session });
    console.log("✅ Webhooks registered for", session.shop);

    // 2️⃣ Use the `admin` client directly
    const response = await admin.rest.post({
      path: 'pages',
      data: {
        page: {
          title: "Loyalty Dashboard",
          body_html: `
            <div id="loyalty-dashboard">
          <h1>Loyalty Dashboard</h1>

          <p>Welcome to your loyalty dashboard. Here you can view your points,
          rewards, and activity.</p>

          <!-- Your app can hydrate this later -->
          <div id="loyalty-dashboard-root"></div>
        </div>
          `,
          metafields: [
            {
              namespace: "loyalty",
          key: "dashboard",
          type: "single_line_text_field",
          value: "true",
            },
          ],
        },
      },
    });

      const data = await response.json();

  } catch (error) {
    console.error("❌ Failed to create page:", error);
  }
},


  },


});
// ✅ Custom authenticate wrapper
export const authenticate = {
  admin: async (request: Request) => {
    const url = new URL(request.url);

    // 🔓 Bypass admin auth for App Proxy routes
    if (url.pathname.startsWith('/loyalty-program')) {
      return null;
    }

    // 🔐 Normal admin authentication
    return shopify.authenticate.admin(request);
  },

  // Keep default behaviors
  public: shopify.authenticate.public,
  webhook: shopify.authenticate.webhook,
};
export const authenticate = shopify.authenticate;
export const addDocumentRequestHeaders =
  shopify.addDocumentResponseHeaders;

export const addDocumentResponseHeaders =
  shopify.addDocumentResponseHeaders;

export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
export const apiVersion = ApiVersion.January25;

export default shopify;
