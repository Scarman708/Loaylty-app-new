import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Authenticate the app proxy request
    const { liquid } = await authenticate.public.appProxy(request);

    // Get customer ID from query params
    const url = new URL(request.url);
    const customerId = url.searchParams.get("customerId");

    if (!customerId) {
      return json({ error: "Customer ID required" }, { status: 400 });
    }

    // Get the shop domain from the app proxy request
    const shop = request.headers.get('x-shopify-shop-domain') || 
                url.searchParams.get('shop');

    if (!shop) {
      return json({ error: "Shop domain not found in request" }, { status: 400 });
    }

    // Find loyalty member in database
    const loyaltyMember = await db.customer.findFirst({
      where: {
        shopCustomerId: BigInt(customerId),
        shop: {
          shopDomain: shop,
        },
      },
      include: {
        currentTier: {
          select: {
            name: true,
            minPoints: true,
          },
        },
      },
    });

    if (!loyaltyMember) {
      return json({
        enrolled: false,
        error: "Not enrolled in loyalty program",
      }, { status: 404 });
    }

    // Get transactions (last 10)
    const transactions = await db.pointLedger.findMany({
      where: {
        customerId: loyaltyMember.id,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
      select: {
        createdAt: true,
        delta: true,
        reason: true,
        source: true,
        note: true,
      },
    });

    // Return dashboard data
    return json({
      success: true,
      enrolled: true,
      points: loyaltyMember.pointBalance || 0,
      tier: loyaltyMember.currentTier?.name || "Bronze",
      joinedDate: loyaltyMember.createdAt,
      lifetimePoints: loyaltyMember.lifetimePoints || 0,
      transactions: transactions.map((t) => ({
        date: t.createdAt,
        points: t.delta,
        description: t.note || `${t.source} - ${t.reason}`,
      })),
    });
  } catch (error) {
    console.error("Dashboard API error:", error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
};