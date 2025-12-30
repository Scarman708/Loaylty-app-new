import { json, LoaderFunctionArgs } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { Card, Layout, Page, DataTable, Text, BlockStack, InlineStack, Box, Divider } from '@shopify/polaris';
import { TitleBar } from '@shopify/app-bridge-react';
import { authenticate } from '../shopify.server';
import db from '../db.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!session) {
    throw new Response('Authentication failed', { status: 401 });
  }
  const shop = session.shop;

  // Get shop data
  const shopData = await db.shop.findUnique({
    where: { shopDomain: shop },
    include: {
      program: true,
      customers: true,
      ledgers: true,
      tiers: {
        orderBy: { minPoints: 'asc' },
      },
    },
  });

  if (!shopData) {
    throw new Response('Shop not found', { status: 404 });
  }

  // Calculate points summary
  const totalPointsEarned = shopData.ledgers
    .filter(ledger => ['EARN', 'ADJUST'].includes(ledger.reason))
    .reduce((sum, ledger) => sum + Number(ledger.delta), 0);

  const totalPointsRedeemed = Math.abs(shopData.ledgers
    .filter(ledger => ledger.reason === 'REDEEM')
    .reduce((sum, ledger) => sum + Number(ledger.delta), 0));

  // Count customers with point balance > 0 as active
  const activeCustomers = shopData.customers.filter(c => c.pointBalance > 0).length;

  // Get recent activity
  const recentActivity = await db.pointLedger.findMany({
    where: { shopId: shopData.id },
    orderBy: { createdAt: 'desc' },
    take: 5,
    include: { customer: true },
  });

  // Get customers with their details
  const customersWithDetails = await db.customer.findMany({
    where: { shopId: shopData.id },
    include: {
      ledgers: true,
      currentTier: true,
    },
  });

  // Get all tiers for this shop
  const allTiers = await db.tier.findMany({
    where: { shopId: shopData.id },
    orderBy: { minPoints: 'asc' },
  });

  // Process customer data with additional details
  const customerList = customersWithDetails.map(customer => {
    const totalPoints = customer.lifetimePoints; // Using lifetimePoints from the customer model
    const joinDate = customer.createdAt;
    
    // Determine tier based on points or use current tier
    let customerTier = customer.currentTier?.name || 'Bronze';
    if (!customer.currentTier && allTiers.length > 0) {
      // If no current tier, find the highest tier the customer qualifies for
      for (let i = allTiers.length - 1; i >= 0; i--) {
        if (totalPoints >= allTiers[i].minPoints) {
          customerTier = allTiers[i].name;
          break;
        }
      }
    }

    return {
      id: customer.id,
      email: customer.email || 'No email',
      name: customer.email?.split('@')[0] || 'Customer',
      points: totalPoints,
      tier: customerTier,
      joinDate: joinDate,
      orderCount: 0, // Not directly available in the schema
      lastOrder: customer.lastEarnedAt || customer.lastRedeemedAt || null,
    };
  });

  return json({
    shop: {
      name: shop,
      currency: shopData.currencyCode || 'USD',
      createdAt: shopData.installedAt,
    },
    program: shopData.program,
    stats: {
      totalCustomers: shopData.customers.length,
      activeCustomers,
      totalPointsEarned,
      totalPointsRedeemed,
      activePoints: totalPointsEarned - totalPointsRedeemed,
    },
    tiers: shopData.tiers,
    recentActivity: recentActivity.map(activity => ({
      id: activity.id,
      customer: activity.customer?.email || 'Unknown',
      points: activity.delta,
      reason: activity.reason,
      createdAt: activity.createdAt,
    })),
    customers: customerList,
  });
};

export default function DashboardPage() {
  const { shop, program, stats, tiers, recentActivity, customers } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Loyalty Dashboard" />
      
      {/* Program Summary */}
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Program Overview</Text>
              <Divider />
              <InlineStack gap="400" wrap={false}>
                <Box minWidth="200px">
                  <Text as="p" variant="bodyMd" tone="subdued">Points per {shop.currency}</Text>
                  <Text as="p" variant="headingXl">{program?.pointsPerCurrency || 0}</Text>
                </Box>
                <Box minWidth="200px">
                  <Text as="p" variant="bodyMd" tone="subdued">Total Customers</Text>
                  <Text as="p" variant="headingXl">{stats.totalCustomers}</Text>
                </Box>
                <Box minWidth="200px">
                  <Text as="p" variant="bodyMd" tone="subdued">Active Points</Text>
                  <Text as="p" variant="headingXl">{stats.activePoints.toLocaleString()}</Text>
                </Box>
                <Box minWidth="200px">
                  <Text as="p" variant="bodyMd" tone="subdued">Total Points Earned</Text>
                  <Text as="p" variant="headingXl">{stats.totalPointsEarned.toLocaleString()}</Text>
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">Program Settings</Text>
              <Divider />
              <BlockStack gap="200">
                <Text as="p"><strong>Points per {shop.currency}:</strong> {program?.pointsPerCurrency}</Text>
                <Text as="p"><strong>Rounding:</strong> {program?.rounding || 'None'}</Text>
                <Text as="p"><strong>Exclude Discounts:</strong> {program?.excludeDiscounts ? 'Yes' : 'No'}</Text>
                <Text as="p"><strong>Earn on Shipping:</strong> {program?.earnOnShipping ? 'Yes' : 'No'}</Text>
                <Text as="p"><strong>Min. Order Value:</strong> {program?.minSubtotalCents ? `$${(program.minSubtotalCents / 100).toFixed(2)}` : 'None'}</Text>
              </BlockStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">Tiers</Text>
              <Divider />
              <BlockStack gap="200">
                {tiers && tiers.length > 0 ? (
                  tiers.map(tier => (
                    <Box key={tier.id} paddingBlockEnd="200">
                      <Text as="p" variant="bodyMd"><strong>{tier.name}</strong> (from {tier.minPoints} points)</Text>
                    </Box>
                  ))
                ) : (
                  <Text as="p" variant="bodyMd" tone="subdued">No tiers configured</Text>
                )}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">Recent Activity</Text>
              <Divider />
              {recentActivity.length > 0 ? (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text']}
                  headings={['Customer', 'Points', 'Action', 'Date']}
                  rows={recentActivity.map(activity => [
                    activity.customer,
                    activity.points > 0 ? `+${activity.points}` : activity.points,
                    activity.reason,
                    new Date(activity.createdAt).toLocaleString(),
                  ])}
                />
              ) : (
                <Text as="p" variant="bodyMd" tone="subdued">No recent activity</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">Customer Loyalty Details</Text>
              <Divider />
              {customers && customers.length > 0 ? (
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'numeric', 'numeric', 'text', 'text']}
                  headings={['Name', 'Email', 'Tier', 'Points', 'Orders', 'Join Date', 'Last Order']}
                  rows={customers.map(customer => [
                    customer.name,
                    customer.email,
                    customer.tier,
                    customer.points,
                    customer.orderCount,
                    new Date(customer.joinDate).toLocaleDateString(),
                    customer.lastOrder ? new Date(customer.lastOrder).toLocaleDateString() : 'N/A',
                  ])}
                  sortable={[true, true, true, true, true, true, true]}
                  initialSortColumnIndex={3}
                  defaultSortDirection="descending"
                  footerContent={`Showing ${customers.length} customers`}
                />
              ) : (
                <Text as="p" variant="bodyMd" tone="subdued">No customer data available</Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
