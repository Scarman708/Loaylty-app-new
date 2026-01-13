import '@shopify/shopify-app-remix/server/adapters/node';
import {
  shopifyApp,
  DeliveryMethod,
  LATEST_API_VERSION,
  ApiVersion,
} from '@shopify/shopify-app-remix/server';
import { setupLoyaltyMetafields } from "~/utils/shopifyMetafields.server";


import { PrismaSessionStorage } from '@shopify/shopify-app-session-storage-prisma';
import prisma from '~/db.server';

console.log('🔧 Shopify Config:', {
  apiKey: process.env.SHOPIFY_API_KEY,
  appUrl: process.env.SHOPIFY_APP_URL,
  hasSecret: !!process.env.SHOPIFY_API_SECRET,
});

export const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  appUrl: process.env.SHOPIFY_APP_URL!,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,
  authPathPrefix: '/auth',
  
  // Use offline tokens for stability
  useOnlineTokens: false,
  
  scopes: (process.env.SCOPES ??
    'read_orders,write_orders,read_customers,write_customers,write_content')
    .split(',')
    .map(s => s.trim()),

  sessionStorage: new PrismaSessionStorage(prisma as any),

  webhooks: {
     ORDERS_CREATE: {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    },
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
         await prisma.shop.upsert({
        where: { shopDomain: session.shop },
        update: {
          accessToken: session.accessToken,
          status: 'ACTIVE',
        },
        create: {
          shopDomain: session.shop,
          accessToken: session.accessToken,
          status: 'ACTIVE',
          // Add any other required fields from your schema
        },
      });
      console.log("✅ Shop saved to database");

        await shopify.registerWebhooks({ session });
        console.log("✅ Webhooks registered");
 await setupLoyaltyMetafields(session.shop);
      console.log("✅ Loyalty metafields set up");
     
        const response = await admin.rest.post({
          path: 'pages',
          data: {
            page: {
              title: "Loyalty Dashboard",
              body_html: `<div id="loyalty-dashboard"><h1>Loyalty Dashboard</h1></div>`,
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

        console.log("✅ Page created");
      } catch (error) {
        console.error("❌ Error in afterAuth:", error);
      }
    },
  },
});

export const authenticate = shopify.authenticate;
export const addDocumentRequestHeaders = shopify.addDocumentResponseHeaders;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
export const apiVersion = ApiVersion.January25;

export default shopify;