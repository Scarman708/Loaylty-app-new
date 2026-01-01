// app/services/pageService.server.ts
import { shopify } from "~/shopify.server";

import type { Session } from "@shopify/shopify-api";

/**
 * Creates the "Loyalty Dashboard" page if it doesn't exist
 * @param adminClient - REST Admin API client
 */
export async function createLoyaltyDashboardPage(adminClient: any) {
  try {
    // 1️⃣ Check if page already exists
    const pagesResponse = await adminClient.get({
      path: "pages",
      query: {
        title: "Loyalty Dashboard",
        fields: "id,handle,title",
      },
    });

    // Ensure body.pages is safe
    const pages = (pagesResponse.body?.pages ?? []);
    if (pages.length > 0) {
      console.log("ℹ️ Loyalty dashboard page already exists");
      return pages[0];
    }

    // 2️⃣ Create the new page
    const pageData = {
      page: {
        title: "Loyalty Dashboard",
        handle: "loyalty-dashboard",
        body_html: `
          <div id="loyalty-dashboard-app">
            <p>Add the loyalty dashboard block via theme editor.</p>
          </div>
        `,
      },
    };

    const newPageResponse = await adminClient.post({
      path: "pages",
      data: pageData,
    });

    const createdPage = newPageResponse.body?.page;
    if (!createdPage) {
      throw new Error("Page creation failed: no page returned from Shopify");
    }

    console.log("✅ Loyalty dashboard page created:", createdPage.handle);
    return createdPage;
  } catch (error) {
    console.error("❌ Error in createLoyaltyDashboardPage:", error);
    throw error;
  }
}


