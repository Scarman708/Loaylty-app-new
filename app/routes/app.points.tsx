import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData, useNavigation } from '@remix-run/react';
import { authenticate } from '../shopify.server';
import { Page, Layout, Card, DataTable, Spinner, Banner } from '@shopify/polaris';
import db from '../db.server';

interface CustomerPoints {
  id: string | number;
  name: string;
  email: string;
  points: number;
  lifetimePoints: number;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  
  // First, get the shop ID from the database using the shop domain
  let shopId: number;
  
  try {
    // Try to find the shop by the full URL first
    let shop = await db.shop.findFirst({
      where: { 
        OR: [
          { shopDomain: session.shop },
          { shopDomain: { contains: session.shop.replace('https://', '').split('.')[0] } },
        ]
      },
      select: { id: true },
    });

    // If shop not found, try to get the first available shop
    if (!shop) {
      shop = await db.shop.findFirst({
        select: { id: true },
      });
    }

    if (!shop) {
      // If still no shop found, try to create one
      const newShop = await db.shop.create({
        data: {
          shopDomain: session.shop,
          accessToken: 'temp', // This will be updated on app installation
          currencyCode: 'USD', // Default currency
        },
        select: { id: true },
      });
      shopId = newShop.id;
    } else {
      shopId = shop.id;
    }
  } catch (error) {
    console.error('Error finding or creating shop:', error);
    return json({
      error: 'Shop initialization error',
      details: 'Could not initialize shop data',
    }, { status: 500 });
  }
  
  try {
    console.log('Attempting to fetch customers from database...');
    
    // First try to get customers from the database
    const dbCustomers = await db.customer.findMany({
      where: { 
        shop: { id: shopId },
      },
      select: {
        id: true,
        shopCustomerId: true,
        pointBalance: true,
        lifetimePoints: true,
        email: true,
      },
      orderBy: { pointBalance: 'desc' },
      take: 100,
    });

    console.log(`Found ${dbCustomers.length} customers in database`);

    // If we have customers in the database, return them
    if (dbCustomers.length > 0) {
      const customers = dbCustomers.map(customer => ({
        id: customer.id,
        name: customer.email?.split('@')[0] || `Customer ${customer.id}`,
        email: customer.email || 'No email',
        points: customer.pointBalance,
        lifetimePoints: customer.lifetimePoints,
      }));

      return json({ 
        customers,
        source: 'database' as const,
      });
    }
    
    console.log('No customers found in database, falling back to Shopify API');

    // If no customers in database, try to fetch from Shopify API
    try {
      console.log('Attempting to fetch customers from Shopify Admin API...');
      
      // First, check if we have the required permissions
      const response = await admin.graphql(
        `#graphql
          query {
            shop {
              name
            }
            customers(first: 10) {
              edges {
                node {
                  id
                  email
                }
              }
            }
          }
        `
      );

      const responseData = await response.json();
      
      if (responseData.errors) {
        console.error('GraphQL Errors:', responseData.errors);
        throw new Error(`API Error: ${responseData.errors[0]?.message || 'Unknown error'}`);
      }
      
      if (!responseData.data?.customers) {
        console.error('Unexpected response format:', responseData);
        throw new Error('Unexpected response format from Shopify API');
      }

      const customers = responseData.data.customers.edges.map((edge: any) => {
        const email = edge.node.email || '';
        const name = email.split('@')[0] || `Customer ${edge.node.id}`;
        
        return {
          id: edge.node.id,
          name,
          email: email || 'No email',
          points: 0,
          lifetimePoints: 0,
        };
      });

      console.log(`Successfully fetched ${customers.length} customers from Shopify`);

      return json({ 
        customers,
        source: 'shopify' as const,
      });
    } catch (error) {
      console.error('Error fetching customers from Shopify:', error);
      throw new Error(`Could not fetch customer data: ${error instanceof Error ? error.message : 'Unknown error'}. Please ensure the app has the required permissions.`);
    }
  } catch (error) {
    console.error('Error in points loader:', error);
    return json({
      error: 'Failed to load customer points data',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
};

export default function CustomerPoints() {
  const navigation = useNavigation();
  const data = useLoaderData<typeof loader>();

  if ('error' in data) {
    return (
      <Page title="Error">
        <Layout>
          <Layout.Section>
            <Banner
              title="Error loading customer data"
              tone="critical"
            >
              <p>{data.details || 'An unknown error occurred'}</p>
              <p>Please check your app permissions and try again.</p>
            </Banner>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const { customers, source } = data;

  const rows = customers.map((customer: CustomerPoints) => [
    customer.name,
    customer.email,
    customer.points.toLocaleString(),
    customer.lifetimePoints.toLocaleString(),
  ]);

  return (
    <Page
      title="Customer Points"
      subtitle={`Viewing ${customers.length} customers (${source} data)`}
      fullWidth
    >
      {navigation.state === 'loading' && <Spinner accessibilityLabel="Loading customers" />}
      <Layout>
        <Layout.Section>
          <Card>
            <DataTable
              columnContentTypes={['text', 'text', 'numeric', 'numeric']}
              headings={['Customer', 'Email', 'Current Points', 'Lifetime Points']}
              rows={rows}
              sortable={[true, true, true, true]}
              defaultSortDirection="descending"
              initialSortColumnIndex={2}
              footerContent={`Showing ${rows.length} of ${customers.length} customers`}
            />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
