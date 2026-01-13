import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useNavigation, useSearchParams } from '@remix-run/react';
import { useCallback, useState } from 'react';

import { authenticate } from '../shopify.server';
import db from '../db.server';

import {
  Page,
  Layout,
  Card,
  DataTable,
  Spinner,
  Banner,
  TextField,
  Select,
  Badge,
  Text,
  Box,
  Button,
  Icon,
  Pagination,
  ButtonGroup,
  InlineStack,
} from '@shopify/polaris';
import { SearchIcon, FilterIcon } from '@shopify/polaris-icons';
interface CustomerPoints {
  id: string;
  name: string;
  email: string;
  points: number;
  lifetimePoints: number;
  lastEarnedAt?: string | null;
  joinedAt?: string | null;
}

interface Transaction {
  id: string;
  date: string;
  type: 'earn' | 'spend' | 'adjustment' | 'referral';
  points: number;
  orderId?: string | null;
  orderName?: string | null;
  status: 'pending' | 'available' | 'expired' | 'cancelled';
  metadata?: Record<string, any>;
}

interface PointsData {
  customers: CustomerPoints[];
  transactions: Transaction[];
  pagination: {
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
  };
  stats: {
    totalPoints: number;
    activeCustomers: number;
    pendingPoints: number;
  };
  source: 'database' | 'api';
  error?: string;
}

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleString();
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'PENDING':
      return <Badge tone="info">Pending</Badge>;
    case 'AVAILABLE':
      return <Badge tone="success">Available</Badge>;
    case 'EXPIRED':
      return <Badge tone="warning">Expired</Badge>;
    case 'CANCELLED':
      return <Badge tone="critical">Cancelled</Badge>;
    default:
      return <Badge>{status}</Badge>;
  }
}

function getTypeBadge(type: string) {
  switch (type) {
    case 'earn':
      return <Badge tone="success">Earned</Badge>;
    case 'spend':
      return <Badge tone="info">Spent</Badge>;
    case 'referral':
      return <Badge tone="attention">Referral</Badge>;
    case 'adjustment':
      return <Badge tone="warning">Adjusted</Badge>;
    default:
      return <Badge>{type}</Badge>;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const perPage = 10;
  const search = url.searchParams.get('search') || '';
  const status = url.searchParams.get('status') || '';

  try {
    // Get or create shop
    const shop = await db.shop.upsert({
      where: { shopDomain: session.shop },
      update: {},
      create: {
        shopDomain: session.shop,
        accessToken: 'temp',
        currencyCode: 'USD',
      },
      select: { id: true },
    });

    const shopId = shop.id;

    // Build where clause for customers
    const customerWhere: any = { shopId };

    if (search) {
      const orConditions: any[] = [
        { email: { contains: search, mode: 'insensitive' } },
      ];

      if (/^\d+$/.test(search)) {
        orConditions.push({ shopCustomerId: { equals: BigInt(search) } });
      }

      customerWhere.OR = orConditions;
    }

    // Get customers with pagination
    const [customers, totalCustomers] = await Promise.all([
      db.customer.findMany({
        where: customerWhere,
        select: {
          id: true,
          email: true,
          pointBalance: true,
          lifetimePoints: true,
          lastEarnedAt: true,
          createdAt: true,
        },
        orderBy: { pointBalance: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      db.customer.count({ where: customerWhere }),
    ]);

    // Build where clause for transactions
    const transactionWhere: any = { shopId };
    if (status) {
      transactionWhere.status = status;
    }
    if (search) {
      transactionWhere.OR = [
        { customer: { email: { contains: search, mode: 'insensitive' } } },
        { orderName: { contains: search, mode: 'insensitive' } },
        { metadata: { path: ['orderNumber'], equals: search } },
      ];
    }

    // Get transactions for the dashboard
    const recentTransactions = await db.pointLedger.findMany({
      where: transactionWhere,
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        customer: {
          select: { email: true },
        },
      },
    });

    // Get stats
    const [totalPoints, pendingPoints] = await Promise.all([
      db.customer.aggregate({
        where: { shopId },
        _sum: { pointBalance: true },
      }),
      db.pointLedger.aggregate({
        where: {
          shopId,
          status: 'PENDING',
        },
        _sum: { delta: true },
      }),
    ]);

    // Format the data
    const formattedCustomers: CustomerPoints[] = customers.map((customer) => ({
      id: customer.id.toString(),
      name: customer.email?.split('@')[0] || `Customer ${customer.id}`,
      email: customer.email || 'No email',
      points: customer.pointBalance,
      lifetimePoints: customer.lifetimePoints,
      lastEarnedAt: customer.lastEarnedAt?.toISOString(),
      joinedAt: customer.createdAt.toISOString(),
    }));

    const formattedTransactions: Transaction[] = recentTransactions.map((tx) => ({
      id: tx.id.toString(),
      date: tx.createdAt.toISOString(),
      type:
        tx.reason === 'REFERRAL_BONUS'
          ? 'referral'
          : tx.reason === 'EARN'
          ? 'earn'
          : 'adjustment',
      points: tx.delta,
      orderId: tx.orderId?.toString(),
      orderName: tx.orderName,
      status: tx.status.toLowerCase() as Transaction['status'],
      metadata: tx.metadata as Record<string, any>,
    }));

    return json({
      customers: formattedCustomers,
      transactions: formattedTransactions,
      pagination: {
        total: totalCustomers,
        page,
        perPage,
        totalPages: Math.ceil(totalCustomers / perPage),
      },
      stats: {
        totalPoints: totalPoints._sum.pointBalance || 0,
        activeCustomers: totalCustomers,
        pendingPoints: pendingPoints._sum.delta || 0,
      },
      source: 'database' as const,
    });
  } catch (error) {
    console.error('Error in points loader:', error);
    return json(
      {
        error: 'Failed to load customer points data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
};

export default function CustomerPoints() {
  const navigation = useNavigation();
  const isLoading = navigation.state !== 'idle';

  const {
    customers = [],
    transactions = [],
    pagination,
    stats,
    source,
    error,
  } = useLoaderData<typeof loader>() as any; // TODO: tighten typing if desired

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState(searchParams.get('search') || '');
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || '');

  // Update URL when filters change
  const handleSearch = useCallback(() => {
    const params = new URLSearchParams(searchParams);

    if (searchValue) {
      params.set('search', searchValue);
      params.set('page', '1');
    } else {
      params.delete('search');
    }

    if (statusFilter) {
      params.set('status', statusFilter);
      params.set('page', '1');
    } else {
      params.delete('status');
    }

    setSearchParams(params);
  }, [searchValue, statusFilter, searchParams, setSearchParams]);

  // Handle pagination
  const handlePagination = (page: number) => {
    const params = new URLSearchParams(searchParams);
    params.set('page', page.toString());
    setSearchParams(params);
  };

  // Handle status filter change
  const handleStatusFilterChange = useCallback(
    (value: string) => {
      setStatusFilter(value);
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set('status', value);
        params.set('page', '1');
      } else {
        params.delete('status');
      }
      setSearchParams(params);
    },
    [searchParams, setSearchParams],
  );

  // Handle search input change
  const handleSearchChange = useCallback((value: string) => {
    setSearchValue(value);
  }, []);

  // Handle search submit
  const handleSearchSubmit = useCallback(() => {
    handleSearch();
  }, [handleSearch]);

  // Handle clear filters
  const handleClearFilters = useCallback(() => {
    setSearchValue('');
    setStatusFilter('');
    setSearchParams({});
  }, [setSearchParams]);

  if (error) {
    return (
      <Page title="Points">
        <Layout>
          <Layout.Section>
            <Banner title="Error" tone="critical">
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // Customer table rows
  const customerRows = customers.map((customer: CustomerPoints) => [
    <Text as="span" variant="bodyMd" fontWeight="semibold" key={`name-${customer.id}`}>
      {customer.name}
    </Text>,
    <Text as="span" variant="bodyMd" key={`email-${customer.id}`}>
      {customer.email}
    </Text>,
    <Text as="span" variant="bodyMd" key={`points-${customer.id}`}>
      {customer.points.toLocaleString()}
    </Text>,
    <Text as="span" variant="bodyMd" key={`lifetime-${customer.id}`}>
      {customer.lifetimePoints.toLocaleString()}
    </Text>,
    <Text as="span" variant="bodyMd" key={`last-earned-${customer.id}`}>
      {customer.lastEarnedAt ? formatDate(customer.lastEarnedAt) : 'Never'}
    </Text>,
  ]);

  // Transaction table rows
  const transactionRows = transactions.map((tx: Transaction) => [
    <Text as="span" variant="bodyMd" key={`type-${tx.id}`}>
      {getTypeBadge(tx.type)}
    </Text>,
    <Text as="span" variant="bodyMd" key={`points-${tx.id}`}>
      {tx.points > 0 ? `+${tx.points}` : tx.points}
    </Text>,
    <Text as="span" variant="bodyMd" key={`order-${tx.id}`}>
      {tx.orderName ? `#${tx.orderName}` : 'N/A'}
    </Text>,
    <Text as="span" variant="bodyMd" key={`date-${tx.id}`}>
      {formatDate(tx.date)}
    </Text>,
    <Text as="span" variant="bodyMd" key={`status-${tx.id}`}>
      {getStatusBadge(tx.status.toUpperCase())}
    </Text>,
  ]);

  return (
    <Page title="Loyalty Points Dashboard">
      <Layout>
        {/* Stats Overview */}
        <Layout.Section>
          <Card>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '1rem',
              }}
            >
              <Box padding="400" background="bg-surface" borderRadius="200">
                <Text as="h3" variant="headingSm">
                  Total Points
                </Text>
                <Text as="p" variant="headingXl">
                  {stats?.totalPoints.toLocaleString()}
                </Text>
              </Box>
              <Box padding="400" background="bg-surface" borderRadius="200">
                <Text as="h3" variant="headingSm">
                  Active Customers
                </Text>
                <Text as="p" variant="headingXl">
                  {stats?.activeCustomers.toLocaleString()}
                </Text>
              </Box>
              <Box padding="400" background="bg-surface" borderRadius="200">
                <Text as="h3" variant="headingSm">
                  Pending Points
                </Text>
                <Text as="p" variant="headingXl">
                  {stats?.pendingPoints.toLocaleString()}
                </Text>
              </Box>
            </div>
          </Card>
        </Layout.Section>

        {/* Search and Filters */}
        <Layout.Section>
          <Card>
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
              <div style={{ flex: 1 }} onKeyDown={(event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSearchSubmit();
    }
  }}>
                <TextField
                  label="Search customers or orders"
                  value={searchValue}
                  onChange={handleSearchChange}
                  prefix={<Icon source={SearchIcon} />}
                  placeholder="Search by email, name, or order #"
                  autoComplete="off"
                />
              </div>
              <div style={{ minWidth: '200px' }}>
                <Select
                  label="Status filter"
                  options={[
                    { label: 'All Statuses', value: '' },
                    { label: 'Available', value: 'AVAILABLE' },
                    { label: 'Pending', value: 'PENDING' },
                    { label: 'Expired', value: 'EXPIRED' },
                    { label: 'Cancelled', value: 'CANCELLED' },
                  ]}
                  value={statusFilter}
                  onChange={handleStatusFilterChange}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <Button onClick={handleSearchSubmit} variant="primary">
                  Search
                </Button>
              </div>
            </div>
            {(searchParams.get('search') || searchParams.get('status')) && (
              <div style={{ marginBottom: '1rem' }}>
                <ButtonGroup>
                  <Button onClick={handleClearFilters}>Clear filters</Button>
                </ButtonGroup>
              </div>
            )}
          </Card>
        </Layout.Section>

        {/* Recent Transactions */}
        <Layout.Section>
          <Card>
            <Text as="h2" variant="headingLg">
              Recent Transactions
            </Text>
            {isLoading ? (
              <Box padding="400">
                <InlineStack align="center" blockAlign="center">
                  <Spinner accessibilityLabel="Loading transactions" size="large" />
                </InlineStack>
              </Box>
            ) : transactions.length > 0 ? (
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                headings={['Type', 'Points', 'Order', 'Date', 'Status']}
                rows={transactionRows}
                footerContent={`Showing ${transactions.length} of ${
                  pagination?.total ?? 0
                } transactions`}
              />
            ) : (
              <Box padding="400">
                <Text as="p" variant="bodyMd" alignment="center">
                  No transactions found
                </Text>
              </Box>
            )}
          </Card>
        </Layout.Section>

        {/* Customer Points */}
        <Layout.Section>
          <Card>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1rem',
              }}
            >
              <Text as="h2" variant="headingLg">
                Customer Points
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {pagination?.total ?? 0} total customers
              </Text>
            </div>
            {isLoading ? (
              <Box padding="400">
                <InlineStack align="center" blockAlign="center">
                  <Spinner accessibilityLabel="Loading customers" size="large" />
                </InlineStack>
              </Box>
            ) : customers.length > 0 ? (
              <div>
                <DataTable
                  columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                  headings={['Name', 'Email', 'Points', 'Lifetime Points', 'Last Earned']}
                  rows={customerRows}
                  footerContent={`Showing ${customers.length} of ${
                    pagination?.total ?? 0
                  } customers`}
                />
                <div
                  style={{
                    marginTop: '1rem',
                    display: 'flex',
                    justifyContent: 'center',
                  }}
                >
                  <Pagination
                    hasPrevious={pagination?.page > 1}
                    onPrevious={() => handlePagination((pagination?.page || 1) - 1)}
                    hasNext={(pagination?.page || 1) < (pagination?.totalPages || 1)}
                    onNext={() => handlePagination((pagination?.page || 1) + 1)}
                    label={`Page ${pagination?.page ?? 1} of ${pagination?.totalPages ?? 1}`}
                  />
                </div>
              </div>
            ) : (
              <Box padding="400">
                <Text as="p" variant="bodyMd" alignment="center">
                  No customers found
                </Text>
              </Box>
            )}
            <div style={{ marginTop: '1rem', textAlign: 'right' }}>
              <Text as="span" variant="bodySm" tone="subdued">
                Data source: {source}
              </Text>
            </div>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}