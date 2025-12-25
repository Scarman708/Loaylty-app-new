import { json, type ActionFunctionArgs, redirect } from '@remix-run/node';
import { Form, useLoaderData, useActionData } from '@remix-run/react';
import { useState } from 'react';
import { Card, Layout, Page, Text, BlockStack, TextField, Button, InlineStack, Box, Divider } from '@shopify/polaris';
import { TitleBar } from '@shopify/app-bridge-react';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import type { ProgramSettings, RoundingMode } from '@prisma/client';

// Types for our form data
type SettingsFormData = {
  pointsPerDollar: number;
  minOrderValue: number;
  earnOnShipping: boolean;
  excludeDiscounts: boolean;
  rounding: RoundingMode;
  maxPointsPerOrder: number | null;
  dailyEarnCap: number | null;
  monthlyEarnCap: number | null;
};

export const loader = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { shopDomain: session.shop },
    include: { program: true }
  });

  if (!shop?.program) {
    // If no program settings exist, create default ones
    const defaultProgram = await db.programSettings.create({
      data: {
        shopId: shop!.id,
        pointsPerCurrency: 10, // Default 10 points per dollar
        rounding: 'nearest',
        minSubtotalCents: 0,
        earnOnShipping: false,
        excludeDiscounts: false,
      },
    });
    return json({ program: defaultProgram });
  }

  return json({ 
    program: shop.program,
    currency: shop.currencyCode || 'USD'
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  // Get form values
  const pointsPerDollar = formData.get('pointsPerDollar');
  const minOrderValue = formData.get('minOrderValue');
  
  const settings: SettingsFormData = {
    pointsPerDollar: pointsPerDollar ? Number(pointsPerDollar) : 0,
    minOrderValue: minOrderValue ? Number(minOrderValue) : 0,
    earnOnShipping: formData.get('earnOnShipping') === 'on',
    excludeDiscounts: formData.get('excludeDiscounts') === 'on',
    rounding: (formData.get('rounding') as RoundingMode) || 'nearest',
    maxPointsPerOrder: formData.get('maxPointsPerOrder') ? Number(formData.get('maxPointsPerOrder')) : null,
    dailyEarnCap: formData.get('dailyEarnCap') ? Number(formData.get('dailyEarnCap')) : null,
    monthlyEarnCap: formData.get('monthlyEarnCap') ? Number(formData.get('monthlyEarnCap')) : null,
  };

  // Validate the form data
  const errors: Record<string, string> = {};
  if (isNaN(settings.pointsPerDollar) || settings.pointsPerDollar <= 0) {
    errors.pointsPerDollar = 'Points per dollar must be a positive number';
  }
  if (isNaN(settings.minOrderValue) || settings.minOrderValue < 0) {
    errors.minOrderValue = 'Minimum order value cannot be negative';
  }

  if (Object.keys(errors).length > 0) {
    return json({ errors }, { status: 400 });
  }

  const shop = await db.shop.findUnique({ where: { shopDomain: session.shop } });
  if (!shop) {
    throw new Response('Shop not found', { status: 404 });
  }

  // Update the program settings
  await db.programSettings.upsert({
    where: { shopId: shop.id },
    update: {
      pointsPerCurrency: settings.pointsPerDollar,
      minSubtotalCents: Math.round(settings.minOrderValue * 100), // Convert to cents
      earnOnShipping: settings.earnOnShipping,
      excludeDiscounts: settings.excludeDiscounts,
      rounding: settings.rounding,
      maxPointsPerOrder: settings.maxPointsPerOrder,
      dailyEarnCap: settings.dailyEarnCap,
      monthlyEarnCap: settings.monthlyEarnCap,
    },
    create: {
      shopId: shop.id,
      pointsPerCurrency: settings.pointsPerDollar,
      minSubtotalCents: Math.round(settings.minOrderValue * 100),
      earnOnShipping: settings.earnOnShipping,
      excludeDiscounts: settings.excludeDiscounts,
      rounding: settings.rounding,
      maxPointsPerOrder: settings.maxPointsPerOrder,
      dailyEarnCap: settings.dailyEarnCap,
      monthlyEarnCap: settings.monthlyEarnCap,
    },
  });

  return redirect('/app/dashboard');
};

type LoaderData = {
  program: ProgramSettings;
  currency: string;
};

export default function SettingsPage() {
  const { program, currency } = useLoaderData<{
    program: ProgramSettings;
    currency: string;
  }>();
  const actionData = useActionData<{ errors?: Record<string, string> }>();
  
  // Initialize form state with program data
  const [formData, setFormData] = useState({
    pointsPerDollar: program?.pointsPerCurrency?.toString() || '10',
    minOrderValue: program?.minSubtotalCents ? (program.minSubtotalCents / 100).toFixed(2) : '0',
    maxPointsPerOrder: program?.maxPointsPerOrder?.toString() || '',
    dailyEarnCap: program?.dailyEarnCap?.toString() || '',
    monthlyEarnCap: program?.monthlyEarnCap?.toString() || '',
    rounding: program?.rounding || 'nearest',
    excludeDiscounts: program?.excludeDiscounts || false,
    earnOnShipping: program?.earnOnShipping || false,
  });

  // Handle input changes for TextField components
  const handleTextFieldChange = (value: string, name: string) => {
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Handle checkbox changes
  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: checked
    }));
  };

  // Handle select changes
  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };
  
  return (
    <Page>
      <TitleBar title="Loyalty Program Settings" />
      <Layout>
        <Layout.Section>
          <Card>
            <Form method="post">
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">Points Configuration</Text>
                <Divider />
                
                <TextField
                  label={`Points per ${currency} spent`}
                  name="pointsPerDollar"
                  type="number"
                  min={1}
                  step={1}
                  autoComplete="off"
                  value={formData.pointsPerDollar}
                  onChange={(value) => handleTextFieldChange(value, 'pointsPerDollar')}
                  error={actionData?.errors?.pointsPerDollar}
                  helpText={`Customers will earn this many points for each ${currency} spent`}
                />

                <TextField
                  label="Minimum order value to earn points"
                  name="minOrderValue"
                  type="number"
                  min={0}
                  step={0.01}
                  autoComplete="off"
                  value={formData.minOrderValue}
                  onChange={(value) => handleTextFieldChange(value, 'minOrderValue')}
                  error={actionData?.errors?.minOrderValue}
                  prefix={currency}
                  helpText="Set to 0 to allow points on all orders"
                />

                <TextField
                  label="Maximum points per order (optional)"
                  name="maxPointsPerOrder"
                  type="number"
                  min={0}
                  step={1}
                  autoComplete="off"
                  value={formData.maxPointsPerOrder}
                  onChange={(value) => handleTextFieldChange(value, 'maxPointsPerOrder')}
                  helpText="Leave empty for no limit"
                />

                <TextField
                  label="Daily earn cap (optional)"
                  name="dailyEarnCap"
                  type="number"
                  min={0}
                  step={1}
                  autoComplete="off"
                  value={formData.dailyEarnCap}
                  onChange={(value) => handleTextFieldChange(value, 'dailyEarnCap')}
                  helpText="Maximum points a customer can earn per day"
                />

                <TextField
                  label="Monthly earn cap (optional)"
                  name="monthlyEarnCap"
                  type="number"
                  min={0}
                  step={1}
                  autoComplete="off"
                  value={formData.monthlyEarnCap}
                  onChange={(value) => handleTextFieldChange(value, 'monthlyEarnCap')}
                  helpText="Maximum points a customer can earn per month"
                />

                <div style={{ marginBottom: '1rem' }}>
                  <Text as="p" variant="bodyMd" fontWeight="medium">Point rounding</Text>
                  <select 
                    name="rounding"
                    value={formData.rounding}
                    onChange={handleSelectChange}
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #c4cdd5',
                      marginTop: '0.5rem',
                      marginBottom: '0.5rem'
                    }}
                  >
                    <option value="nearest">Round to nearest whole number</option>
                    <option value="up">Always round up</option>
                    <option value="down">Always round down</option>
                  </select>
                  <Text as="p" variant="bodySm" tone="subdued">How to handle fractional points</Text>
                </div>

                <div style={{ margin: '1rem 0' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      name="excludeDiscounts"
                      checked={formData.excludeDiscounts}
                      onChange={handleCheckboxChange}
                      style={{ width: '1rem', height: '1rem' }}
                    />
                    <Text as="span" variant="bodyMd">Exclude discounts from point calculations</Text>
                  </label>
                  <Text as="p" variant="bodySm" tone="subdued">
                    When enabled, points are calculated on the pre-discount order total
                  </Text>
                </div>

                <div style={{ margin: '1rem 0' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      name="earnOnShipping"
                      checked={formData.earnOnShipping}
                      onChange={handleCheckboxChange}
                      style={{ width: '1rem', height: '1rem' }}
                    />
                    <Text as="span" variant="bodyMd">Award points on shipping costs</Text>
                  </label>
                  <Text as="p" variant="bodySm" tone="subdued">
                    When enabled, shipping costs will be included in point calculations
                  </Text>
                </div>

                <Divider />
                
                <InlineStack align="end">
                  <Button submit variant="primary">
                    Save Settings
                  </Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}