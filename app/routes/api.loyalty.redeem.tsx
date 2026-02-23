import { json } from "@remix-run/node";
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // Authenticate the request
    const { liquid } = await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const shop = request.headers.get('x-shopify-shop-domain') || url.searchParams.get('shop');
    
    if (!shop) {
      return json({ error: "Shop domain not found" }, { status: 400 });
    }

    // Parse request body
    const body = await request.json();
    const { customerId, ruleId, points, orderId, metadata } = body;

    if (!customerId || !ruleId || !points) {
      return json(
        { error: "Missing required fields: customerId, ruleId, and points are required" },
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
        select: {
          id: true,
          shopId: true,
          pointBalance: true,
          lifetimePoints: true,
        },
      });

      if (!customer) {
        return json({ error: "Customer not found" }, { status: 404 });
      }

      // Get the redemption rule
      const redemptionRule = await tx.redemptionRule.findFirst({
        where: {
          id: ruleId,
          shop: { shopDomain: shop },
          enabled: true,
          OR: [
            { activeFrom: null, activeUntil: null },
            { activeFrom: { lte: new Date() }, activeUntil: null },
            { activeFrom: null, activeUntil: { gte: new Date() } },
            { 
              activeFrom: { lte: new Date() },
              activeUntil: { gte: new Date() }
            }
          ]
        }
      });

      if (!redemptionRule) {
        return json({ error: "Invalid or inactive redemption rule" }, { status: 400 });
      }

      // Validate points
      if (points <= 0) {
        return json({ error: "Points must be greater than zero" }, { status: 400 });
      }

      // Check minimum points requirement
      if (points < redemptionRule.minPoints) {
        return json(
          { error: `Minimum ${redemptionRule.minPoints} points required for this redemption` },
          { status: 400 }
        );
      }

      // Check if points are in correct steps if stepPoints is defined
      if (redemptionRule.stepPoints && points % redemptionRule.stepPoints !== 0) {
        return json(
          { error: `Points must be in increments of ${redemptionRule.stepPoints}` },
          { status: 400 }
        );
      }

      // Check if customer has enough points
      if (customer.pointBalance < points) {
        return json(
          { error: "Insufficient points for redemption" },
          { status: 400 }
        );
      }

      // Generate a unique redemption code if required
      let redemptionCode: string | undefined = undefined;
      if (redemptionRule.requiresCode) {
        redemptionCode = `REDEEM-${Date.now()}-${Math.random().toString(36).substr(2, 8).toUpperCase()}`;
      }

      // Calculate discount value if applicable
      let valueCents: number | undefined = undefined;
      if (redemptionRule.discountCents) {
        valueCents = redemptionRule.discountCents;
      } else if (redemptionRule.discountPercent && metadata?.subtotalCents) {
        valueCents = Math.round(metadata.subtotalCents * (redemptionRule.discountPercent / 100));
        
        // Apply maximum discount if specified
        if (redemptionRule.maxDiscountCents && valueCents > redemptionRule.maxDiscountCents) {
          valueCents = redemptionRule.maxDiscountCents;
        }
      }

      // Create the redemption record
      const redemption = await tx.rewardRedemption.create({
        data: {
          shopId: customer.shopId,
          customerId: customer.id,
          ruleId: redemptionRule.id,
          pointsUsed: points,
          rewardType: redemptionRule.type,
          rewardValue: { discountCents: valueCents },
          code: redemptionCode,
          valueCents: valueCents,
          status: "COMPLETED",
          orderId: orderId ? BigInt(orderId) : undefined,
          metadata: metadata || {},
        },
      });

      // Update customer's point balance
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          pointBalance: {
            decrement: points,
          },
          lastRedeemedAt: new Date(),
        },
      });

      // Record the point deduction in the ledger
      await tx.pointLedger.create({
        data: {
          shopId: customer.shopId,
          customerId: customer.id,
          delta: -points,
          reason: "REDEEM",
          source: "ORDER",
          note: `Redeemed ${points} points for ${redemptionRule.title}`,
          orderId: orderId ? BigInt(orderId) : undefined,
          status: "AVAILABLE",
          availableAt: new Date(),
          metadata: {
            redemptionId: redemption.id,
            ruleId: redemptionRule.id,
            ruleType: redemptionRule.type,
          },
        },
      });

      return json({
        success: true,
        redemption: {
          id: redemption.id,
          code: redemption.code,
          pointsUsed: redemption.pointsUsed,
          valueCents: redemption.valueCents,
          ruleType: redemptionRule.type,
          ruleTitle: redemptionRule.title,
          createdAt: redemption.createdAt,
        },
        remainingPoints: customer.pointBalance - points,
      });
    });
  } catch (error) {
    console.error("Redemption error:", error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return json(
      { error: "Failed to process redemption", details: errorMessage },
      { status: 500 }
    );
  }
};
