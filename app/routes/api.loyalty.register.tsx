import { json } from "@remix-run/node";
import prisma from "~/db.server";
import type { ActionFunctionArgs } from "@remix-run/node";
import crypto from "crypto";
import { syncCustomerToShopify } from "~/utils/shopifyCustomer.server";
import { loyaltyProgram } from "~/services/loyaltyProgram.server";

// Add console type declarations
declare const console: Console;

const corsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true'
});

// Verify Shopify App Proxy signature
function verifyShopifyProxy(query: URLSearchParams, secret: string): boolean {
  const signature = query.get('signature');
  if (!signature) {
    console.log("⚠️ No signature found in request");
    return false;
  }

  const params = new URLSearchParams(query);
  params.delete('signature');

  const sortedParams = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('');

  const hash = crypto
    .createHmac('sha256', secret)
    .update(sortedParams)
    .digest('hex');

  const isValid = hash === signature;
  console.log("🔐 Signature verification:", isValid ? "✅ Valid" : "❌ Invalid");
  
  return isValid;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  console.log("🚀 Register action called");
  console.log("📍 Request URL:", request.url);
  console.log("🔤 Request Method:", request.method);
  
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    console.log("✅ Handling OPTIONS preflight");
    return new Response(null, {
      status: 204,
      headers: corsHeaders('*'),
    });
  }
  
  const origin = request.headers.get('Origin') || '*';
  
  try {
    if (request.method !== "POST") {
      console.log("❌ Method not allowed:", request.method);
      return json(
        { error: "Method not allowed" },
        { status: 405, headers: corsHeaders(origin) }
      );
    }

    // Extract shop from URL query parameters (Shopify adds this automatically)
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');
    const loggedInCustomerId = url.searchParams.get('logged_in_customer_id');
    
    console.log("🏪 Shop from query params:", shop);
    console.log("👤 Logged in customer ID:", loggedInCustomerId);
    console.log("📋 All query params:", Array.from(url.searchParams.entries()));

    // Verify Shopify signature for security (REQUIRED for App Proxy)
    const apiSecret = process.env.SHOPIFY_API_SECRET;
    if (!apiSecret) {
      console.error("❌ SHOPIFY_API_SECRET not configured!");
      return json(
        { error: "Server configuration error" },
        { status: 500, headers: corsHeaders(origin) }
      );
    }

    const isValid = verifyShopifyProxy(url.searchParams, apiSecret);
    
    if (!isValid) {
      console.log("❌ Invalid Shopify signature");
      return json(
        { error: "Invalid request signature" },
        { status: 401, headers: corsHeaders(origin) }
      );
    }

    if (!shop) {
      console.log("❌ No shop parameter in request");
      return json(
        { error: "Missing shop parameter. This request must come from a Shopify store." },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    // Parse request body
    let body;
    try {
      body = await request.json();
      console.log("📦 Request body:", JSON.stringify(body, null, 2));
    } catch (error) {
      console.log("❌ Invalid JSON in request body");
      return json(
        { error: "Invalid JSON payload" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }
    
    const { shopCustomerId, email, acceptsMarketing, referralCode } = body;

    // Validate required fields
    if (!shopCustomerId || !email) {
      console.log("❌ Missing required fields");
      return json(
        { error: "Missing required fields: shopCustomerId and email" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    console.log("🔍 Looking for shop in database:", shop);

    // Find shop by shopDomain
    const shopRecord = await prisma.shop.findUnique({
      where: { shopDomain: shop },
      select: {
        id: true,
        shopDomain: true,
        status: true,
      }
    });

    if (!shopRecord) {
      console.log("❌ Shop not found in database:", shop);
      return json(
        { 
          error: "Shop not found",
          details: "This shop is not registered in the loyalty program. Please ensure the app is installed."
        },
        { status: 404, headers: corsHeaders(origin) }
      );
    }

    console.log("✅ Shop found - ID:", shopRecord.id, "Status:", shopRecord.status);

    // Check if shop is active
    if (shopRecord.status !== 'ACTIVE') {
      console.log("⚠️ Shop is not active:", shopRecord.status);
      return json(
        { 
          error: "Loyalty program is not active",
          details: "The loyalty program is currently inactive for this shop."
        },
        { status: 403, headers: corsHeaders(origin) }
      );
    }

    // Convert shopCustomerId to BigInt
    const customerIdBigInt = BigInt(shopCustomerId);
    console.log("🔍 Checking for existing customer with ID:", shopCustomerId);
    
    // Check if customer already exists
    const existingCustomer = await prisma.customer.findUnique({
      where: {
        shopId_shopCustomerId: {
          shopId: shopRecord.id,
          shopCustomerId: customerIdBigInt
        }
      },
      include: {
        currentTier: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (existingCustomer) {
      console.log("ℹ️ Customer already registered - ID:", existingCustomer.id);
      
      const serializedCustomer = {
        id: existingCustomer.id.toString(),
        email: existingCustomer.email,
        shopCustomerId: existingCustomer.shopCustomerId.toString(),
        pointBalance: existingCustomer.pointBalance.toString(),
        lifetimePoints: existingCustomer.lifetimePoints.toString(),
        tier: existingCustomer.currentTier?.name || 'Member'
      };
      
      return json(
        { 
          success: true, 
          message: "You're already part of our loyalty program!",
          alreadyRegistered: true,
          customer: serializedCustomer
        },
        { headers: corsHeaders(origin) }
      );
    }

    // Get default tier (tier with lowest minPoints)
    console.log("🎯 Getting default tier for shop:", shopRecord.id);
    
    const defaultTier = await prisma.tier.findFirst({
      where: { 
        shopId: shopRecord.id
      },
      orderBy: { minPoints: "asc" },
      select: {
        id: true,
        name: true,
        minPoints: true
      }
    });

    if (!defaultTier) {
      console.log("⚠️ No tiers found for shop - customer will be created without a tier");
    } else {
      console.log("✅ Default tier found:", defaultTier.name, "- ID:", defaultTier.id);
    }

    // Create customer
    console.log("👤 Creating new customer...");
    console.log("   - Shop ID:", shopRecord.id);
    console.log("   - Customer ID:", shopCustomerId);
    console.log("   - Email:", email);
    console.log("   - Tier ID:", defaultTier?.id || 'none');
    
    const customer = await prisma.customer.create({
      data: {
        shopId: shopRecord.id,
        shopCustomerId: customerIdBigInt,
        email: email,
        acceptsMarketing: acceptsMarketing ?? false,
        referredByCode: referralCode || null,
        currentTierId: defaultTier?.id || null,
        pointBalance: 0,
        lifetimePoints: 0,
        isActive: true,
      },
      include: {
    currentTier: {
      select: {
        id: true,
        name: true,
        minPoints: true
      }
    }
  }
    });
    
    await syncCustomerToShopify(shop, customer.id.toString());

   console.log("✅ Customer created successfully!");
console.log("   - Customer DB ID:", customer.id);
console.log("   - Points Balance:", customer.pointBalance);
console.log("   - Tier:", customer.currentTier?.name || 'None');

// 🎁 Award welcome bonus
try {
  await loyaltyProgram.awardWelcomeBonus(
    shopRecord.id,
    parseInt(customer.shopCustomerId.toString()),
  );
  console.log("🎁 Welcome bonus awarded successfully!");
} catch (bonusError) {
  console.error("❌ Failed to award welcome bonus:", bonusError);
}

/* -------------------------------------------------- */
/* 🔥 IMPORTANT FIX: Reload updated customer from DB  */
/* -------------------------------------------------- */

const updatedCustomer = await prisma.customer.findUnique({
  where: { id: customer.id },
  include: {
    currentTier: {
      select: {
        id: true,
        name: true,
        minPoints: true
      }
    }
  }
});

if (!updatedCustomer) {
  console.error("❌ Customer disappeared after creation!");
  return json(
    { error: "Customer creation failed unexpectedly" },
    { status: 500, headers: corsHeaders(origin) }
  );
}

console.log("🔄 Reloaded customer after bonus:");
console.log("   - New Points Balance:", updatedCustomer.pointBalance);
console.log("   - Lifetime Points:", updatedCustomer.lifetimePoints);

/* -------------------------------------------------- */
/* 📦 Serialize UPDATED customer (not stale one)      */
/* -------------------------------------------------- */

const serializedCustomer = {
  id: updatedCustomer.id.toString(),
  email: updatedCustomer.email,
  shopCustomerId: updatedCustomer.shopCustomerId.toString(),
  pointBalance: updatedCustomer.pointBalance.toString(),
  lifetimePoints: updatedCustomer.lifetimePoints.toString(),
  tier: updatedCustomer.currentTier?.name || 'No tier',
  acceptsMarketing: updatedCustomer.acceptsMarketing
};

return json(
  { 
    success: true,
    message: "Successfully joined loyalty program!",
    customer: serializedCustomer
  },
  { headers: corsHeaders(origin) }
);
  } catch (error) {
    console.error('❌ ERROR in loyalty registration:');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('Error type:', error?.constructor?.name);
    console.error('Error message:', error instanceof Error ? error.message : String(error));
    
    if (error instanceof Error && error.stack) {
      console.error('Stack trace:', error.stack);
    }
    
    // Check if it's a Prisma error
    if (error && typeof error === 'object' && 'code' in error) {
      console.error('Prisma error code:', (error as any).code);
      console.error('Prisma error meta:', (error as any).meta);
      
      // Handle specific Prisma errors
      const prismaError = error as any;
      if (prismaError.code === 'P2002') {
        return json(
          { error: "Customer already exists with this ID" },
          { status: 409, headers: corsHeaders(origin || '*') }
        );
      }
    }
    
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    return json(
      { 
        error: "Internal server error",
        details: error instanceof Error ? error.message : 'Unknown error occurred'
      },
      { status: 500, headers: corsHeaders(origin || '*') }
    );
  }
};