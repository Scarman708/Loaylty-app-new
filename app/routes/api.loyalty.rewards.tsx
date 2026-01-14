import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // Authenticate the request
    const { liquid } = await authenticate.public.appProxy(request);
    const url = new URL(request.url);
    const shop = request.headers.get('x-shopify-shop-domain') || url.searchParams.get('shop');
    const customerId = url.searchParams.get('customerId');
    
    if (!shop) {
      return json({ error: "Shop domain not found" }, { status: 400 });
    }

    // Get customer's point balance if customerId is provided
    let customerPoints = 0;
    if (customerId) {
      const customer = await db.customer.findFirst({
        where: {
          shopCustomerId: BigInt(customerId),
          shop: { shopDomain: shop },
        },
        select: {
          pointBalance: true,
        },
      });
      
      if (customer) {
        customerPoints = customer.pointBalance;
      }
    }

    // Get all active redemption rules for this shop
    const now = new Date();
    const redemptionRules = await db.redemptionRule.findMany({
      where: {
        shop: { shopDomain: shop },
        enabled: true,
        OR: [
          { activeFrom: null, activeUntil: null },
          { activeFrom: { lte: now }, activeUntil: null },
          { activeFrom: null, activeUntil: { gte: now } },
          { 
            activeFrom: { lte: now },
            activeUntil: { gte: now }
          }
        ]
      },
      orderBy: [
        { minPoints: 'asc' },
        { id: 'asc' }
      ],
      select: {
        id: true,
        type: true,
        title: true,
        description: true,
        minPoints: true,
        stepPoints: true,
        discountCents: true,
        discountPercent: true,
        maxDiscountCents: true,
        requiresCode: true,
        conditions: true,
      },
    });

    // Process rules to determine eligibility
    const rewards = redemptionRules.map(rule => {
      const canRedeem = customerPoints >= rule.minPoints;
      let nextStepPoints = null;
      
      // Calculate next step points if stepPoints is defined
      if (rule.stepPoints && rule.stepPoints > 1) {
        if (customerPoints > rule.minPoints) {
          const steps = Math.ceil((customerPoints - rule.minPoints) / rule.stepPoints);
          nextStepPoints = rule.minPoints + (steps * rule.stepPoints);
        } else {
          nextStepPoints = rule.minPoints;
        }
      }

      return {
        ...rule,
        canRedeem,
        nextStepPoints: nextStepPoints !== rule.minPoints ? nextStepPoints : null,
        discountValue: rule.discountCents || rule.discountPercent || 0,
        discountType: rule.discountCents ? 'FIXED_AMOUNT' : 
                     rule.discountPercent ? 'PERCENTAGE' : 'OTHER',
      };
    });

    return json({
      success: true,
      rewards,
      customerPoints,
    });
  } catch (error) {
    console.error("Error fetching rewards:", error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return json(
      { error: "Failed to fetch rewards", details: errorMessage },
      { status: 500 }
    );
  }
};
