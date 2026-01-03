import { json, type ActionFunctionArgs, redirect } from '@remix-run/node';
import { Form, useLoaderData, useActionData } from '@remix-run/react';
import { useState } from 'react';
import { 
  Card, 
  Layout, 
  Page, 
  Text, 
  BlockStack, 
  TextField, 
  Button, 
  InlineStack, 
  Box, 
  Divider,
  DataTable,
  Badge,
  Icon,
  ButtonGroup,
} from '@shopify/polaris';
import { TitleBar } from '@shopify/app-bridge-react';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { ArrowUpIcon, ArrowDownIcon } from '@shopify/polaris-icons';
import { ProgramSettings, RoundingMode, PointRuleType, PointRule } from '@prisma/client';

type PointRuleForm = {
  id?: number;
  type: PointRuleType;
  points: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
};

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

const DEFAULT_POINT_RULES: Record<PointRuleType, Omit<PointRuleForm, 'id'>> = {
  PURCHASE: {
    type: 'PURCHASE',
    points: '100',
    description: 'For every $1 spent',
    isActive: true,
    sortOrder: 0
  },
  SIGNUP: {
    type: 'SIGNUP',
    points: '500',
    description: 'Account signup bonus',
    isActive: true,
    sortOrder: 1
  },
  BIRTHDAY: {
    type: 'BIRTHDAY',
    points: '200',
    description: 'Birthday bonus',
    isActive: true,
    sortOrder: 2
  },
  REVIEW: {
    type: 'REVIEW',
    points: '50',
    description: 'Leaving a product review',
    isActive: true,
    sortOrder: 3
  },
  REFERRAL: {
    type: 'REFERRAL',
    points: '100',
    description: 'Referring a friend',
    isActive: true,
    sortOrder: 4
  },
  SOCIAL_SHARE: {
    type: 'SOCIAL_SHARE',
    points: '50',
    description: 'Sharing on social media',
    isActive: true,
    sortOrder: 5
  }
};

async function requireAdmin(request: Request) {
  const admin = await authenticate.admin(request);
  if (!admin) {
    throw new Response('Unauthorized', { status: 401 });
  }
  return admin;
}

export const loader = async ({ request }: ActionFunctionArgs) => {
  const { session } = await requireAdmin(request);

  const shop = await db.shop.findUnique({
    where: { shopDomain: session.shop },
    include: {
      program: true,
      pointRules: {
        orderBy: { sortOrder: 'asc' }
      }
    }
  });

  if (!shop) {
    throw new Response('Shop not found', { status: 404 });
  }

  if (!shop.program) {
    // Create default program settings and point rules
    await db.$transaction([
      db.programSettings.create({
        data: {
          shopId: shop.id,
          pointsPerCurrency: 100, // Points per dollar
          rounding: 'nearest',
          minSubtotalCents: 0,
          earnOnShipping: false,
          excludeDiscounts: false,
        },
      }),
      // Create default point rules
      ...Object.values(DEFAULT_POINT_RULES).map(rule => 
        db.pointRule.create({
          data: {
            shopId: shop.id,
            type: rule.type,
            points: parseInt(rule.points, 10) || 0,
            description: rule.description,
            isActive: rule.isActive,
            sortOrder: rule.sortOrder
          }
        })
      )
    ]);

    // Refetch to get the program with point rules
    const updatedShop = await db.shop.findUnique({
      where: { id: shop.id },
      include: {
        program: true,
        pointRules: {
          orderBy: { sortOrder: 'asc' }
        }
      }
    });

    return json({ 
      program: updatedShop!.program!,
      pointRules: updatedShop!.pointRules,
      currency: shop.currencyCode || 'USD'
    });
  }

  // Ensure all default point rules exist
  const existingRuleTypes = new Set(shop.pointRules.map(r => r.type));

  const missingRules = Object.entries(DEFAULT_POINT_RULES)
    .filter(([type]) => !existingRuleTypes.has(type as PointRuleType))
    .map(([_, rule], index) => ({
      ...rule,
      points: rule.points.toString(),
      sortOrder: shop.pointRules.length + index
    }));

  if (missingRules.length > 0) {
    await db.$transaction(
      missingRules.map(rule => 
        db.pointRule.create({
          data: {
            shopId: shop.id,
            type: rule.type,
            points: parseInt(rule.points, 10) || 0,
            description: rule.description,
            isActive: rule.isActive,
            sortOrder: rule.sortOrder
          }
        })
      )
    );

    // Refetch with updated rules
    const updatedShop = await db.shop.findUnique({
      where: { id: shop.id },
      include: {
        program: true,
        pointRules: {
          orderBy: { sortOrder: 'asc' }
        }
      }
    });

    return json({
      program: updatedShop!.program!,
      pointRules: updatedShop!.pointRules,
      currency: shop.currencyCode || 'USD',
    });
  }

  return json({ 
    program: shop.program,
    pointRules: shop.pointRules,
    currency: shop.currencyCode || 'USD'
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await requireAdmin(request);
  const formData = await request.formData();
  
  // Handle point rules update
  if (formData.get('_action') === 'updatePointRules') {
    const shop = await db.shop.findUnique({ 
      where: { shopDomain: session.shop },
      include: { program: true }
    });
    
    if (!shop?.program) {
      throw new Response('Program not found', { status: 404 });
    }
    
    // Get all point rules from form data
    const ruleTypes = Object.values(PointRuleType);
    const updates = [];
    
    for (const type of ruleTypes) {
      const points = formData.get(`rule_${type}_points`);
      const description = formData.get(`rule_${type}_description`);
      const isActive = formData.get(`rule_${type}_active`) === 'on';
      const sortOrder = formData.get(`rule_${type}_sortOrder`);
      
      if (points !== null && description !== null) {
        updates.push({
          where: { shopId_type: { shopId: shop.id, type } },
          update: {
            points: parseInt(points.toString(), 10) || 0,
            description: description.toString(),
            isActive,
            sortOrder: sortOrder ? parseInt(sortOrder.toString(), 10) : 0
          },
          create: {
            shopId: shop.id,
            type: type as PointRuleType,
            points: parseInt(points.toString(), 10) || 0,
            description: description.toString(),
            isActive,
            sortOrder: sortOrder ? parseInt(sortOrder.toString(), 10) : 0
          }
        });
      }
    }
    
    // Update all rules in a transaction
    await db.$transaction(
      updates.map(update => 
        db.pointRule.upsert(update)
      )
    );
    
    return json({ success: true });
  }
  
  // Handle main settings update
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

  return redirect('/app/settings');
};

const PointRuleTypeLabels: Record<PointRuleType, string> = {
  PURCHASE: 'Purchase',
  SIGNUP: 'Signup',
  BIRTHDAY: 'Birthday',
  REVIEW: 'Review',
  REFERRAL: 'Referral',
  SOCIAL_SHARE: 'Social Share'
};

export default function SettingsPage() {
  const { program, pointRules, currency } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ errors?: Record<string, string> }>();
  
  // Initialize form state with program data
  const [formData, setFormData] = useState({
    pointsPerDollar: program?.pointsPerCurrency?.toString() || '100',
    minOrderValue: program?.minSubtotalCents ? (program.minSubtotalCents / 100).toFixed(2) : '0',
    maxPointsPerOrder: program?.maxPointsPerOrder?.toString() || '',
    dailyEarnCap: program?.dailyEarnCap?.toString() || '',
    monthlyEarnCap: program?.monthlyEarnCap?.toString() || '',
    rounding: program?.rounding || 'nearest',
    excludeDiscounts: program?.excludeDiscounts || false,
    earnOnShipping: program?.earnOnShipping || false,
  });

  // Initialize point rules from loader data
  const [pointRulesState, setPointRulesState] = useState<PointRuleForm[]>(
    pointRules?.map((rule) => ({
      id: rule.id,
      type: rule.type,
      points: rule.points.toString(),
      description: rule.description,
      isActive: rule.isActive,
      sortOrder: rule.sortOrder
    })) || []
  );

  // Handle point rule changes
  const handlePointRuleChange = (index: number, field: keyof PointRuleForm, value: any) => {
    const updatedRules = [...pointRulesState];
    updatedRules[index] = { ...updatedRules[index], [field]: value };
    setPointRulesState(updatedRules);
  };

  // Toggle rule active state
  const toggleRuleActive = (index: number) => {
    const updatedRules = [...pointRulesState];
    updatedRules[index].isActive = !updatedRules[index].isActive;
    setPointRulesState(updatedRules);
  };

  // Move rule up in the list
  const moveRuleUp = (index: number) => {
    if (index === 0) return;
    const updatedRules = [...pointRulesState];
    [updatedRules[index], updatedRules[index - 1]] = [updatedRules[index - 1], updatedRules[index]];
    // Update sort orders
    updatedRules.forEach((rule, i) => {
      rule.sortOrder = i;
    });
    setPointRulesState(updatedRules);
  };

  // Move rule down in the list
  const moveRuleDown = (index: number) => {
    if (index === pointRulesState.length - 1) return;
    const updatedRules = [...pointRulesState];
    [updatedRules[index], updatedRules[index + 1]] = [updatedRules[index + 1], updatedRules[index]];
    // Update sort orders
    updatedRules.forEach((rule, i) => {
      rule.sortOrder = i;
    });
    setPointRulesState(updatedRules);
  };

  // Handle point rules form submission
  const handlePointRulesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const formData = new FormData();
    formData.append('_action', 'updatePointRules');
    
    pointRulesState.forEach((rule) => {
      formData.append(`rule_${rule.type}_points`, rule.points);
      formData.append(`rule_${rule.type}_description`, rule.description);
      formData.append(`rule_${rule.type}_active`, rule.isActive ? 'on' : 'off');
      formData.append(`rule_${rule.type}_sortOrder`, rule.sortOrder.toString());
    });
    
    try {
      const response = await fetch('/app/settings', {
        method: 'POST',
        body: formData,
      });
      
      if (response.ok) {
        // Show success message or update UI as needed
        console.log('Point rules updated successfully');
      } else {
        // Handle error
        console.error('Failed to update point rules');
      }
    } catch (error) {
      console.error('Error updating point rules:', error);
    }
  };

  // Handle input changes for TextField components
  const handleTextFieldChange = (value: string, name: string) => {
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
                    onChange={(e) => handleTextFieldChange(e.target.value, 'rounding')}
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
                      onChange={(e) => setFormData(prev => ({ ...prev, excludeDiscounts: e.target.checked }))}
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
                      onChange={(e) => setFormData(prev => ({ ...prev, earnOnShipping: e.target.checked }))}
                      style={{ width: '1rem', height: '1rem' }}
                    />
                    <Text as="span" variant="bodyMd">Award points on shipping costs</Text>
                  </label>
                  <Text as="p" variant="bodySm" tone="subdued">
                    When enabled, shipping costs will be included in point calculations
                  </Text>
                </div>

                <Divider />
                
                <Box paddingBlockStart="400">
                  <Button submit variant="primary">
                    Save Settings
                  </Button>
                </Box>
              </BlockStack>
            </Form>
          </Card>
          
          {/* Point Rules Section */}
          <Box paddingBlockStart="400">
            <Card>
              <Form onSubmit={handlePointRulesSubmit}>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">Point Rules</Text>
                  <Text as="p" variant="bodyMd">
                    Configure how customers can earn points in your loyalty program.
                  </Text>
                  <Divider />
                  
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                    headings={['Rule', 'Points', 'Description', 'Status', 'Actions']}
                    rows={pointRulesState
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((rule, index) => [
                      PointRuleTypeLabels[rule.type],
                      (
                        <TextField
                          label=""
                          labelHidden
                          type="number"
                          min={0}
                          value={rule.points}
                          onChange={(value) => handlePointRuleChange(index, 'points', value)}
                          autoComplete="off"
                        />
                      ),
                      (
                        <TextField
                          label=""
                          labelHidden
                          value={rule.description}
                          onChange={(value) => handlePointRuleChange(index, 'description', value)}
                          autoComplete="off"
                        />
                      ),
                      (
                        <Badge tone={rule.isActive ? 'success' : 'warning'}>
                          {rule.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      ),
                      (
                        <InlineStack gap="100">
                          <Button
                            size="slim"
                            onClick={() => toggleRuleActive(index)}
                            variant={rule.isActive ? 'secondary' : 'primary'}
                          >
                            {rule.isActive ? 'Deactivate' : 'Activate'}
                          </Button>
                          <ButtonGroup>
                            <Button
                              size="slim"
                              onClick={() => moveRuleUp(index)}
                              disabled={index === 0}
                              icon={<Icon source={ArrowUpIcon} />}
                            />
                            <Button
                              size="slim"
                              onClick={() => moveRuleDown(index)}
                              disabled={index === pointRulesState.length - 1}
                              icon={<Icon source={ArrowDownIcon} />}
                            />
                          </ButtonGroup>
                        </InlineStack>
                      )
                    ])}
                  />
                  
                  <Box paddingBlockStart="400">
                    <Button submit variant="primary">
                      Save Point Rules
                    </Button>
                  </Box>
                </BlockStack>
              </Form>
            </Card>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}