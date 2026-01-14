import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // Authenticate the request
    const { session } = await authenticate.public.appProxy(request);
    if (!session) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { customerId, tierName, shop } = body;

    if (!customerId || !tierName || !shop) {
      return json(
        { error: "Missing required fields: customerId, tierName, and shop are required" },
        { status: 400 }
      );
    }

    // Start a transaction
    return await db.$transaction(async (tx) => {
      // Get the customer with a lock
      const customer = await tx.customer.findFirst({
        where: {
          shopCustomerId: BigInt(customerId),
          shop: { shopDomain: shop },
        },
        include: {
          currentTier: true,
          shop: true,
        },
      });

      if (!customer) {
        return json({ error: "Customer not found" }, { status: 404 });
      }

      // Get the requested tier
      const targetTier = await tx.tier.findFirst({
        where: {
          name: tierName,
          shop: { shopDomain: shop },
        },
      });

      if (!targetTier) {
        return json({ error: "Invalid tier" }, { status: 400 });
      }

      // Check if customer already has this tier
      if (customer.currentTierId === targetTier.id) {
        return json({ 
          success: true, 
          message: `You are already a ${tierName} member` 
        });
      }

      // Check if customer qualifies for this tier
      if (customer.pointBalance < targetTier.minPoints) {
        return json(
          { 
            error: `You need ${targetTier.minPoints - customer.pointBalance} more points to unlock ${tierName} tier` 
          },
          { status: 400 }
        );
      }

      // Update customer's tier
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          currentTier: {
            connect: { id: targetTier.id },
          },
        },
      });

      // Create a ledger entry for the tier upgrade
      await tx.pointLedger.create({
        data: {
          shopId: customer.shopId,
          customerId: customer.id,
          delta: 0,
          reason: "TIER_UPGRADE",
          source: "SYSTEM",
          note: `Upgraded to ${tierName} tier`,
          status: "AVAILABLE",
          availableAt: new Date(),
        },
      });

      return json({
        success: true,
        message: `Successfully upgraded to ${tierName} tier`,
        tier: {
          id: targetTier.id,
          name: targetTier.name,
          minPoints: targetTier.minPoints,
          benefits: targetTier.benefits,
        },
      });
    });

  } catch (error) {
    console.error("Tier upgrade error:", error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return json(
      { 
        success: false,
        error: "Failed to upgrade tier",
        details: errorMessage 
      },
      { status: 500 }
    );
  }
};
