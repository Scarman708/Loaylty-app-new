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

export const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  appUrl: process.env.SHOPIFY_APP_URL!,
  apiVersion: LATEST_API_VERSION,
  isEmbeddedApp: true,

  scopes: (process.env.SCOPES ??
    'read_orders,write_orders,read_customers,write_customers')
    .split(',')
    .map(s => s.trim()),

  sessionStorage: new PrismaSessionStorage(prisma as any),

  webhooks: {
    APP_UNINSTALLED:  { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
    ORDERS_PAID:      { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
    ORDERS_FULFILLED: { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
    ORDERS_UPDATED:   { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
    ORDERS_CANCELLED: { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
    REFUNDS_CREATE:   { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
    CUSTOMERS_CREATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
    CUSTOMERS_UPDATE: { deliveryMethod: DeliveryMethod.Http, callbackUrl: '/webhooks' },
  },

  hooks: {
    afterAuth: async ({ session }) => {
      await shopify.registerWebhooks({ session });
      console.log('✅ Webhooks registered for', session.shop);
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
