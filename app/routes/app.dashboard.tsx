import { json, LoaderFunctionArgs } from '@remix-run/node';
import { Link, useLoaderData } from '@remix-run/react';
import { Card, Layout, Page, DataTable, Text, BlockStack, InlineStack, Box, Divider } from '@shopify/polaris';
import { TitleBar } from '@shopify/app-bridge-react';
import { authenticate, shopify } from '../shopify.server';
import db from '../db.server';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!session) {
    throw new Response('Authentication failed', { status: 401 });
  }
  const shop = session.shop;
  const { admin } = await shopify.authenticate.admin(request);

  // Fetch recent orders from Shopify
  const ordersResponse = await admin.graphql(
    `#graphql
      query GetRecentOrders($first: Int!) {
        orders(first: $first, sortKey: PROCESSED_AT, reverse: true) {
          edges {
            node {
              id
              name
              processedAt
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              displayFulfillmentStatus
              customer {
                displayName
                email
              }
              metafield(namespace: "loyalty", key: "points_awarded") {
                value
              }
            }
          }
        }
      }
    `,
    {
      variables: {
        first: 20,
      },
    }
  );
  
  const ordersData = await ordersResponse.json();
  const recentOrders = ordersData.data?.orders?.edges?.map((edge: any) => ({
    id: edge.node.id,
    name: edge.node.name,
    processedAt: edge.node.processedAt,
    total: edge.node.totalPriceSet?.shopMoney?.amount || '0',
    currency: edge.node.totalPriceSet?.shopMoney?.currencyCode || 'USD',
    status: edge.node.displayFulfillmentStatus,
    customerName: edge.node.customer?.displayName || 'Guest',
    customerEmail: edge.node.customer?.email || 'N/A',
    pointsAwarded: edge.node.metafield?.value ? parseInt(edge.node.metafield.value) : null,
  })) || [];

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
    take: 10,
    include: { customer: true },
  });

  // Get customers with their details
  const customersWithDetails = await db.customer.findMany({
    where: { shopId: shopData.id },
    include: {
      ledgers: true,
      currentTier: true,
    },
    orderBy: { lifetimePoints: 'desc' },
  });

  // Get all tiers for this shop
  const allTiers = await db.tier.findMany({
    where: { shopId: shopData.id },
    orderBy: { minPoints: 'asc' },
  });

  // Process customer data with additional details
  const customerList = customersWithDetails.map(customer => {
    const totalPoints = customer.lifetimePoints;
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

    // Count orders from ledgers (each EARN entry could represent an order)
    const orderCount = customer.ledgers.filter(l => l.reason === 'EARN').length;

    return {
      id: customer.id,
      email: customer.email || 'No email',
      name: customer.email?.split('@')[0] || 'Customer',
      points: totalPoints,
      currentBalance: customer.pointBalance,
      tier: customerTier,
      joinDate: joinDate.toISOString(),
      orderCount: orderCount,
      lastOrder: customer.lastEarnedAt || customer.lastRedeemedAt || null,
    };
  });

  return json({
    shop: {
      name: shop,
      currency: shopData.currencyCode || 'USD',
      createdAt: shopData.installedAt?.toISOString() || new Date().toISOString(),
    },
    program: shopData.program,
    stats: {
      totalCustomers: shopData.customers.length,
      activeCustomers,
      totalPointsEarned,
      totalPointsRedeemed,
      activePoints: totalPointsEarned - totalPointsRedeemed,
    },
    tiers: shopData.tiers.map(tier => ({
      id: tier.id,
      name: tier.name,
      minPoints: tier.minPoints,
      multiplier: tier.multiplier ?? 1,
    })),
    recentActivity: recentActivity.map(activity => ({
      id: activity.id,
      customer: activity.customer?.email || 'Unknown',
      points: activity.delta,
      reason: activity.reason,
      createdAt: activity.createdAt.toISOString(),
    })),
    customers: customerList,
    recentOrders: recentOrders,
  });
};

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatCurrency = (amount: string | number, currency: string) => {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
  }).format(numAmount);
};

export default function DashboardPage() {
  const { shop, program, stats, tiers, recentActivity, customers, recentOrders } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Loyalty Dashboard" />
      
      <Layout>
        {/* Program Summary */}
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
                  <Text as="p" variant="bodyMd" tone="subdued">Active Customers</Text>
                  <Text as="p" variant="headingXl">{stats.activeCustomers}</Text>
                </Box>
                <Box minWidth="200px">
                  <Text as="p" variant="bodyMd" tone="subdued">Active Points</Text>
                  <Text as="p" variant="headingXl">{stats.activePoints.toLocaleString()}</Text>
                </Box>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Two Column Layout */}
        <Layout.Section variant="oneThird">
          {/* Program Settings Card */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h3" variant="headingMd">Program Settings</Text>
                <Link to="/app/settings">
                  <Text as="span" variant="bodyMd" tone="magic">Edit</Text>
                </Link>
              </InlineStack>
              <Divider />
              <BlockStack gap="200">
                <Text as="p"><strong>Points per {shop.currency}:</strong> {program?.pointsPerCurrency || 0}</Text>
                <Text as="p"><strong>Rounding:</strong> {program?.rounding || 'None'}</Text>
                <Text as="p"><strong>Exclude Discounts:</strong> {program?.excludeDiscounts ? 'Yes' : 'No'}</Text>
                <Text as="p"><strong>Earn on Shipping:</strong> {program?.earnOnShipping ? 'Yes' : 'No'}</Text>
                <Text as="p"><strong>Min. Order Value:</strong> {program?.minSubtotalCents ? `${shop.currency} ${(program.minSubtotalCents / 100).toFixed(2)}` : 'None'}</Text>
                {program?.maxPointsPerOrder && (
                  <Text as="p"><strong>Max Points/Order:</strong> {program.maxPointsPerOrder}</Text>
                )}
              </BlockStack>
            </BlockStack>
          </Card>

          {/* Tiers Card */}
          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingMd">Tiers</Text>
                  <Link to="/app/tiers">
                    <Text as="span" variant="bodyMd" tone="magic">Manage</Text>
                  </Link>
                </InlineStack>
                <Divider />
                <BlockStack gap="200">
                  {tiers && tiers.length > 0 ? (
                    tiers.map(tier => (
                      <Box key={tier.id} paddingBlockEnd="200">
                        <Text as="p" variant="bodyMd">
                          <strong>{tier.name}</strong> - {tier.minPoints}+ points
                          {tier.multiplier && tier.multiplier !== 1 && (
                            <Text as="span" tone="subdued"> ({tier.multiplier}x multiplier)</Text>
                          )}
                        </Text>
                      </Box>
                    ))
                  ) : (
                    <Text as="p" variant="bodyMd" tone="subdued">No tiers configured</Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Box>

          {/* Points Statistics */}
          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">Points Statistics</Text>
                <Divider />
                <BlockStack gap="200">
                  <Text as="p"><strong>Total Earned:</strong> {stats.totalPointsEarned.toLocaleString()} pts</Text>
                  <Text as="p"><strong>Total Redeemed:</strong> {stats.totalPointsRedeemed.toLocaleString()} pts</Text>
                  <Text as="p"><strong>Outstanding:</strong> {stats.activePoints.toLocaleString()} pts</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Redemption rate: {stats.totalPointsEarned > 0 
                      ? ((stats.totalPointsRedeemed / stats.totalPointsEarned) * 100).toFixed(1)
                      : 0}%
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </Box>
        </Layout.Section>

        {/* Main Content Column */}
        <Layout.Section>
          {/* Recent Activity */}
          <Card>
            <BlockStack gap="400">
              <Text as="h3" variant="headingMd">Recent Activity</Text>
              <Divider />
              {recentActivity.length > 0 ? (
                <DataTable
                  columnContentTypes={['text', 'numeric', 'text', 'text']}
                  headings={['Customer', 'Points', 'Action', 'Date']}
                  rows={recentActivity.map(activity => [
                    activity.customer,
                    activity.points > 0 ? `+${activity.points}` : activity.points.toString(),
                    activity.reason,
                    formatDate(activity.createdAt),
                  ])}
                />
              ) : (
                <Text as="p" variant="bodyMd" tone="subdued">No recent activity</Text>
              )}
            </BlockStack>
          </Card>

          {/* Recent Orders */}
          {recentOrders.length > 0 && (
            <Box paddingBlockStart="400">
              <Card>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">Recent Orders</Text>
                  <Divider />
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'numeric', 'text', 'text']}
                    headings={['Order', 'Customer', 'Total', 'Points', 'Status', 'Date']}
                    rows={recentOrders.map((order: { name: any; customerName: any; total: string | number; currency: string; pointsAwarded: any; status: any; processedAt: string; }) => [
                      order.name,
                      order.customerName,
                      formatCurrency(order.total, order.currency),
                      order.pointsAwarded ? `+${order.pointsAwarded}` : 'N/A',
                      order.status || 'Pending',
                      formatDate(order.processedAt),
                    ])}
                  />
                </BlockStack>
              </Card>
            </Box>
          )}

          {/* Customer Loyalty Details */}
          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingMd">Top Customers</Text>
                  <Link to="/app/customers">
                    <Text as="span" variant="bodyMd" tone="magic">View All</Text>
                  </Link>
                </InlineStack>
                <Divider />
                {customers && customers.length > 0 ? (
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'numeric', 'numeric', 'text']}
                    headings={['Name', 'Email', 'Tier', 'Lifetime Points', 'Current Balance', 'Join Date']}
                    rows={customers.slice(0, 10).map(customer => [
                      customer.name,
                      customer.email,
                      customer.tier,
                      customer.points.toLocaleString(),
                      customer.currentBalance.toLocaleString(),
                      new Date(customer.joinDate).toLocaleDateString(),
                    ])}
                    sortable={[true, true, true, true, true, true]}
                    defaultSortDirection="descending"
                    footerContent={`Showing ${Math.min(10, customers.length)} of ${customers.length} customers`}
                  />
                ) : (
                  <Text as="p" variant="bodyMd" tone="subdued">No customer data available</Text>
                )}
              </BlockStack>
            </Card>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}