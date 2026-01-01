import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { createLoyaltyDashboardPage } from "~/services/pageService.server";
import db from "~/db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    // ✅ IMPORTANT: destructure `admin`
    const { shop, session, admin } =
      await authenticate.webhook(request);

    console.log(`✅ APP_INSTALLED webhook for ${shop}`);

    if (!session || !admin) {
      console.error("❌ Missing session or admin client");
      return new Response("Unauthorized", { status: 401 });
    }

    // 🗄️ Store / update shop record
    await db.shop.upsert({
      where: { shopDomain: shop },
      update: {
        uninstalledAt: null,
        status: "ACTIVE",
      },
      create: {
        shopDomain: shop,
        accessToken: session.accessToken,
        installedAt: new Date(),
        status: "ACTIVE",
      },
    });

    // 📄 Create loyalty dashboard page
    try {
      await createLoyaltyDashboardPage(admin);
      console.log("✅ Loyalty dashboard page ensured");
    } catch (pageError) {
      console.error("⚠️ Page creation failed:", pageError);
      // Do NOT fail webhook
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("❌ APP_INSTALLED webhook error:", error);
    return new Response("Webhook error", { status: 500 });
  }
};
