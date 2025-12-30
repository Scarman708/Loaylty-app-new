import { json } from "@remix-run/node";
import prisma from "~/db.server";
import { authenticate } from "~/shopify.server";
import type { ActionFunctionArgs } from "@remix-run/node";

// Helper function to add CORS headers
const corsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true'
});

export const action = async ({ request }: ActionFunctionArgs) => {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders('*'),
        'Content-Type': 'application/json',
      },
    });
  }
  
  // Get origin from request headers for CORS
  const origin = request.headers.get('Origin') || '*';
  
  try {
    if (request.method !== "POST") {
      return json(
        { error: "Method not allowed" },
        { 
          status: 405,
          headers: {
            ...corsHeaders(origin),
            'Content-Type': 'application/json',
          }
        }
      );
    }

    const { session } = await authenticate.public.appProxy(request)
;
    if (!session?.shop) {
      return json(
        { error: "Unauthorized" },
        { 
          status: 401,
          headers: {
            ...corsHeaders(origin),
            'Content-Type': 'application/json',
          }
        }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch (error) {
      return json(
        { error: "Invalid JSON payload" },
        { 
          status: 400,
          headers: {
            ...corsHeaders(origin),
            'Content-Type': 'application/json',
          }
        }
      );
    }
    
    const {
      shopCustomerId,
      email,
      acceptsMarketing,
      referralCode
    } = body;

    // 1️⃣ Find shop
    const shop = await prisma.shop.findUnique({
      where: { shopDomain: session.shop }
    });

    if (!shop) {
      return json(
        { error: "Shop not found" },
        { 
          status: 404,
          headers: {
            ...corsHeaders(origin),
            'Content-Type': 'application/json',
          }
        }
      );
    }

    // 2️⃣ Check if customer already registered
    const existingCustomer = await prisma.customer.findUnique({
      where: {
        shopId_shopCustomerId: {
          shopId: shop.id,
          shopCustomerId: BigInt(shopCustomerId)
        }
      }
    });

    if (existingCustomer) {
      return json(
        { success: true, customer: existingCustomer },
        { 
          headers: {
            ...corsHeaders(origin),
            'Content-Type': 'application/json',
          }
        }
      );
    }

    // 3️⃣ Get default tier (lowest minPoints)
    const defaultTier = await prisma.tier.findFirst({
      where: { shopId: shop.id },
      orderBy: { minPoints: "asc" }
    });

    // 4️⃣ Create customer
    const customer = await prisma.customer.create({
      data: {
        shopId: shop.id,
        shopCustomerId: BigInt(shopCustomerId),
        email,
        acceptsMarketing,
        referredByCode: referralCode || null,
        currentTierId: defaultTier?.id
      }
    });

    return json(
      { success: true, customer },
      { 
        headers: {
          ...corsHeaders(origin),
          'Content-Type': 'application/json',
        }
      }
    );
  } catch (error) {
    console.error('Error in loyalty registration:', error);
    return json(
      { error: "Internal server error" },
      { 
        status: 500,
        headers: {
          ...corsHeaders(origin || '*'),
          'Content-Type': 'application/json',
        }
      }
    );
  }
};
