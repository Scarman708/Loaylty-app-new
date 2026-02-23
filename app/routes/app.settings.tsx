import { json, type ActionFunctionArgs, redirect } from '@remix-run/node';
import { Form, useLoaderData, useActionData, useNavigation } from '@remix-run/react';
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
  Banner,
} from '@shopify/polaris';
import { TitleBar } from '@shopify/app-bridge-react';
import { authenticate } from '../shopify.server';
import db from '../db.server';
import { ArrowUpIcon, ArrowDownIcon } from '@shopify/polaris-icons';
import { ProgramSettings, RoundingMode, PointRuleType, PointRule } from '@prisma/client';

const DEFAULT_POINT_RULES: Record<PointRuleType, { type: PointRuleType; points: string; description: string; isActive: boolean; sortOrder: number }> = {
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
    await db.$transaction([
      db.programSettings.create({
        data: {
          shopId: shop.id,
          pointsPerCurrency: 100,
          rounding: 'nearest',
          minSubtotalCents: 0,
          earnOnShipping: false,
          excludeDiscounts: false,
        },
      }),
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
  const actionType = formData.get('_action');
  
  const shop = await db.shop.findUnique({ 
    where: { shopDomain: session.shop },
    include: { program: true }
  });
  
  if (!shop) {
    throw new Response('Shop not found', { status: 404 });
  }

  // Handle point rule reordering
  if (actionType === 'moveRuleUp' || actionType === 'moveRuleDown') {
    const ruleId = parseInt(formData.get('ruleId') as string, 10);
    const currentSortOrder = parseInt(formData.get('currentSortOrder') as string, 10);
    
    const allRules = await db.pointRule.findMany({
      where: { shopId: shop.id },
      orderBy: { sortOrder: 'asc' }
    });
    
    const targetSortOrder = actionType === 'moveRuleUp' ? currentSortOrder - 1 : currentSortOrder + 1;
    const swapRule = allRules.find(r => r.sortOrder === targetSortOrder);
    
    if (swapRule) {
      await db.$transaction([
        db.pointRule.update({
          where: { id: ruleId },
          data: { sortOrder: targetSortOrder }
        }),
        db.pointRule.update({
          where: { id: swapRule.id },
          data: { sortOrder: currentSortOrder }
        })
      ]);
    }
    
    return json({ success: true, message: 'Rule order updated' });
  }

  // Handle toggling rule active status
  if (actionType === 'toggleRule') {
    const ruleId = parseInt(formData.get('ruleId') as string, 10);
    const currentActive = formData.get('currentActive') === 'true';
    
    await db.pointRule.update({
      where: { id: ruleId },
      data: { isActive: !currentActive }
    });
    
    return json({ success: true, message: 'Rule status updated' });
  }
  
  // Handle point rules update
  if (actionType === 'updatePointRules') {
    if (!shop.program) {
      throw new Response('Program not found', { status: 404 });
    }
    
    const ruleTypes = Object.values(PointRuleType);
    const updates = [];
    
    for (const type of ruleTypes) {
      const points = formData.get(`rule_${type}_points`);
      const description = formData.get(`rule_${type}_description`);
      const sortOrder = formData.get(`rule_${type}_sortOrder`);
      
      if (points !== null && description !== null) {
        updates.push({
          where: { shopId_type: { shopId: shop.id, type } },
          update: {
            points: parseInt(points.toString(), 10) || 0,
            description: description.toString(),
            sortOrder: sortOrder ? parseInt(sortOrder.toString(), 10) : 0
          },
          create: {
            shopId: shop.id,
            type: type as PointRuleType,
            points: parseInt(points.toString(), 10) || 0,
            description: description.toString(),
            isActive: true,
            sortOrder: sortOrder ? parseInt(sortOrder.toString(), 10) : 0
          }
        });
      }
    }
    
    await db.$transaction(
      updates.map(update => db.pointRule.upsert(update))
    );
    
    return json({ success: true, message: 'Point rules updated successfully' });
  }
  
  // Handle main settings update
  const pointsPerDollar = formData.get('pointsPerDollar');
  const minOrderValue = formData.get('minOrderValue');
  
  const settings = {
    pointsPerDollar: pointsPerDollar ? Number(pointsPerDollar) : 0,
    minOrderValue: minOrderValue ? Number(minOrderValue) : 0,
    earnOnShipping: formData.get('earnOnShipping') === 'on',
    excludeDiscounts: formData.get('excludeDiscounts') === 'on',
    rounding: (formData.get('rounding') as RoundingMode) || 'nearest',
    maxPointsPerOrder: formData.get('maxPointsPerOrder') ? Number(formData.get('maxPointsPerOrder')) : null,
    dailyEarnCap: formData.get('dailyEarnCap') ? Number(formData.get('dailyEarnCap')) : null,
    monthlyEarnCap: formData.get('monthlyEarnCap') ? Number(formData.get('monthlyEarnCap')) : null,
    
    // Review Points Rules
    reviewBasePoints: formData.get('reviewBasePoints') ? Number(formData.get('reviewBasePoints')) : 50,
    maxReviewsPerMonth: formData.get('maxReviewsPerMonth') ? Number(formData.get('maxReviewsPerMonth')) : 2,
    
    // Welcome Bonuses
    bronzeSignupBonus: formData.get('bronzeSignupBonus') ? Number(formData.get('bronzeSignupBonus')) : 100,
    silverUnlockBonus: formData.get('silverUnlockBonus') ? Number(formData.get('silverUnlockBonus')) : 300,
    goldUnlockBonus: formData.get('goldUnlockBonus') ? Number(formData.get('goldUnlockBonus')) : 500,
    
    // Birthday Reward
    birthdayPoints: formData.get('birthdayPoints') ? Number(formData.get('birthdayPoints')) : 200,
    birthdayExpiryDays: formData.get('birthdayExpiryDays') ? Number(formData.get('birthdayExpiryDays')) : 30,
    birthdayMinDays: formData.get('birthdayMinDays') ? Number(formData.get('birthdayMinDays')) : 7,
    
    // Tier Multipliers
    bronzeSpendMultiplier: formData.get('bronzeSpendMultiplier') ? Number(formData.get('bronzeSpendMultiplier')) : 1.0,
    bronzeReviewMultiplier: formData.get('bronzeReviewMultiplier') ? Number(formData.get('bronzeReviewMultiplier')) : 1.0,
    silverSpendMultiplier: formData.get('silverSpendMultiplier') ? Number(formData.get('silverSpendMultiplier')) : 1.25,
    silverReviewMultiplier: formData.get('silverReviewMultiplier') ? Number(formData.get('silverReviewMultiplier')) : 1.5,
    goldSpendMultiplier: formData.get('goldSpendMultiplier') ? Number(formData.get('goldSpendMultiplier')) : 1.5,
    goldReviewMultiplier: formData.get('goldReviewMultiplier') ? Number(formData.get('goldReviewMultiplier')) : 2.0,
    
    // Tier Qualification
    bronzeThreshold: formData.get('bronzeThreshold') ? Number(formData.get('bronzeThreshold')) : 0,
    silverThreshold: formData.get('silverThreshold') ? Number(formData.get('silverThreshold')) : 2000,
    goldThreshold: formData.get('goldThreshold') ? Number(formData.get('goldThreshold')) : 5000,
    
    // Redemption Rules
    redemptionValue: formData.get('redemptionValue') ? Number(formData.get('redemptionValue')) : 5,
    minRedemption: formData.get('minRedemption') ? Number(formData.get('minRedemption')) : 100,
    preventStacking: formData.get('preventStacking') === 'on',
    
    // Points Expiration
    pointsExpiryMonths: formData.get('pointsExpiryMonths') ? Number(formData.get('pointsExpiryMonths')) : 12,
  };

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

  await db.programSettings.upsert({
    where: { shopId: shop.id },
    update: {
      pointsPerCurrency: settings.pointsPerDollar,
      minSubtotalCents: Math.round(settings.minOrderValue * 100),
      earnOnShipping: settings.earnOnShipping,
      excludeDiscounts: settings.excludeDiscounts,
      rounding: settings.rounding,
      maxPointsPerOrder: settings.maxPointsPerOrder,
      dailyEarnCap: settings.dailyEarnCap,
      monthlyEarnCap: settings.monthlyEarnCap,
      
      // Review Points Rules
      reviewBasePoints: settings.reviewBasePoints,
      maxReviewsPerMonth: settings.maxReviewsPerMonth,
      
      // Welcome Bonuses
      bronzeSignupBonus: settings.bronzeSignupBonus,
      silverUnlockBonus: settings.silverUnlockBonus,
      goldUnlockBonus: settings.goldUnlockBonus,
      
      // Birthday Reward
      birthdayPoints: settings.birthdayPoints,
      birthdayExpiryDays: settings.birthdayExpiryDays,
      birthdayMinDays: settings.birthdayMinDays,
      
      // Tier Multipliers
      bronzeSpendMultiplier: settings.bronzeSpendMultiplier,
      bronzeReviewMultiplier: settings.bronzeReviewMultiplier,
      silverSpendMultiplier: settings.silverSpendMultiplier,
      silverReviewMultiplier: settings.silverReviewMultiplier,
      goldSpendMultiplier: settings.goldSpendMultiplier,
      goldReviewMultiplier: settings.goldReviewMultiplier,
      
      // Tier Qualification
      bronzeThreshold: settings.bronzeThreshold,
      silverThreshold: settings.silverThreshold,
      goldThreshold: settings.goldThreshold,
      
      // Redemption Rules
      redemptionValue: settings.redemptionValue,
      minRedemption: settings.minRedemption,
      preventStacking: settings.preventStacking,
      
      // Points Expiration
      pointsExpiryMonths: settings.pointsExpiryMonths,
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
      
      // Review Points Rules
      reviewBasePoints: settings.reviewBasePoints,
      maxReviewsPerMonth: settings.maxReviewsPerMonth,
      
      // Welcome Bonuses
      bronzeSignupBonus: settings.bronzeSignupBonus,
      silverUnlockBonus: settings.silverUnlockBonus,
      goldUnlockBonus: settings.goldUnlockBonus,
      
      // Birthday Reward
      birthdayPoints: settings.birthdayPoints,
      birthdayExpiryDays: settings.birthdayExpiryDays,
      birthdayMinDays: settings.birthdayMinDays,
      
      // Tier Multipliers
      bronzeSpendMultiplier: settings.bronzeSpendMultiplier,
      bronzeReviewMultiplier: settings.bronzeReviewMultiplier,
      silverSpendMultiplier: settings.silverSpendMultiplier,
      silverReviewMultiplier: settings.silverReviewMultiplier,
      goldSpendMultiplier: settings.goldSpendMultiplier,
      goldReviewMultiplier: settings.goldReviewMultiplier,
      
      // Tier Qualification
      bronzeThreshold: settings.bronzeThreshold,
      silverThreshold: settings.silverThreshold,
      goldThreshold: settings.goldThreshold,
      
      // Redemption Rules
      redemptionValue: settings.redemptionValue,
      minRedemption: settings.minRedemption,
      preventStacking: settings.preventStacking,
      
      // Points Expiration
      pointsExpiryMonths: settings.pointsExpiryMonths,
    },
  });

  return json({ success: true, message: 'Settings updated successfully' });
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
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  
  const isSubmitting = navigation.state === 'submitting';
  const isSettingsSubmitting = isSubmitting && navigation.formData?.get('_action') !== 'updatePointRules' && navigation.formData?.get('_action') !== 'toggleRule' && navigation.formData?.get('_action') !== 'moveRuleUp' && navigation.formData?.get('_action') !== 'moveRuleDown';
  const isPointRulesSubmitting = isSubmitting && navigation.formData?.get('_action') === 'updatePointRules';

  return (
    <Page>
      <TitleBar title="Loyalty Program Settings" />
      <Layout>
        <Layout.Section>
          {actionData && 'success' in actionData && actionData.success && (
            <Box paddingBlockEnd="400">
              <Banner tone="success" onDismiss={() => {}}>
                {actionData.message || 'Changes saved successfully'}
              </Banner>
            </Box>
          )}
          
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
                  value={program?.pointsPerCurrency?.toString() || '1'}
                  error={actionData && 'errors' in actionData ? actionData.errors?.pointsPerDollar : undefined}
                  helpText={`Customers will earn this many points for each ${currency} spent`}
                />
                
                <TextField
                  label="Minimum order value to earn points"
                  name="minOrderValue"
                  type="number"
                  min={0}
                  step={0.01}
                  autoComplete="off"
                  value={program?.minSubtotalCents ? (program.minSubtotalCents / 100).toFixed(2) : '10.00'}
                  error={actionData && 'errors' in actionData ? actionData.errors?.minOrderValue : undefined}
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
                  value={program?.maxPointsPerOrder?.toString() || ''}
                  helpText="Leave empty for no limit"
                />
                
                <TextField
                  label="Daily earn cap (optional)"
                  name="dailyEarnCap"
                  type="number"
                  min={0}
                  step={1}
                  autoComplete="off"
                  value={program?.dailyEarnCap?.toString() || ''}
                  helpText="Maximum points a customer can earn per day"
                />
                
                <TextField
                  label="Monthly earn cap (optional)"
                  name="monthlyEarnCap"
                  type="number"
                  min={0}
                  step={1}
                  autoComplete="off"
                  value={program?.monthlyEarnCap?.toString() || ''}
                  helpText="Maximum points a customer can earn per month"
                />
                
                <div style={{ marginBottom: '1rem' }}>
                  <Text as="p" variant="bodyMd" fontWeight="medium">Point rounding</Text>
                  <select 
                    name="rounding"
                    value={program?.rounding || 'nearest'}
                    defaultValue={program?.rounding || 'nearest'}
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
                      defaultChecked={program?.excludeDiscounts !== false}
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
                      defaultChecked={program?.earnOnShipping || false}
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
                  <Button submit variant="primary" loading={isSettingsSubmitting}>
                    Save Settings
                  </Button>
                </Box>
              </BlockStack>
            </Form>
          </Card>
          
          {/* Review Points Rules Section */}
          <Box paddingBlockStart="400">
            <Card>
              <Form method="post">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">Review Points Rules</Text>
                  <Divider />
                  
                  <TextField
                    label="Base reward points per verified review"
                    name="reviewBasePoints"
                    type="number"
                    min={0}
                    step={1}
                    autoComplete="off"
                    value={program?.reviewBasePoints?.toString() || '50'}
                    helpText="Points awarded for each approved review"
                  />

                  <TextField
                    label="Maximum rewarded reviews per month per customer"
                    name="maxReviewsPerMonth"
                    type="number"
                    min={0}
                    step={1}
                    autoComplete="off"
                    value={program?.maxReviewsPerMonth?.toString() || '2'}
                    helpText="Limit how many review rewards a customer can get per month"
                  />

                  <Box paddingBlockStart="400">
                    <Button submit variant="primary" loading={isSettingsSubmitting}>
                      Save Review Rules
                    </Button>
                  </Box>
                </BlockStack>
              </Form>
            </Card>
          </Box>

          {/* Welcome Bonuses Section */}
          <Box paddingBlockStart="400">
            <Card>
              <Form method="post">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">Welcome Bonuses</Text>
                  <Text as="p" variant="bodyMd">
                    Configure bonus points awarded when customers unlock different tiers.
                  </Text>
                  <Divider />
                  
                  <TextField
                    label="Bronze tier signup bonus"
                    name="bronzeSignupBonus"
                    type="number"
                    min={0}
                    step={1}
                    autoComplete="off"
                    value={program?.bronzeSignupBonus?.toString() || '100'}
                    helpText="Points awarded when customers sign up (Bronze tier)"
                  />

                  <TextField
                    label="Silver tier unlock bonus"
                    name="silverUnlockBonus"
                    type="number"
                    min={0}
                    step={1}
                    autoComplete="off"
                    value={program?.silverUnlockBonus?.toString() || '300'}
                    helpText="Points awarded when customers unlock Silver tier"
                  />

                  <TextField
                    label="Gold tier unlock bonus"
                    name="goldUnlockBonus"
                    type="number"
                    min={0}
                    step={1}
                    autoComplete="off"
                    value={program?.goldUnlockBonus?.toString() || '500'}
                    helpText="Points awarded when customers unlock Gold tier"
                  />

                  <Box paddingBlockStart="400">
                    <Button submit variant="primary" loading={isSettingsSubmitting}>
                      Save Welcome Bonuses
                    </Button>
                  </Box>
                </BlockStack>
              </Form>
            </Card>
          </Box>

          {/* Birthday Reward Section */}
          <Box paddingBlockStart="400">
            <Card>
              <Form method="post">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">Birthday Reward</Text>
                  <Text as="p" variant="bodyMd">
                    Configure annual birthday rewards for customers.
                  </Text>
                  <Divider />
                  
                  <TextField
                    label="Birthday reward points"
                    name="birthdayPoints"
                    type="number"
                    min={0}
                    step={1}
                    autoComplete="off"
                    value={program?.birthdayPoints?.toString() || '200'}
                    helpText="Points awarded annually on customer's birthday"
                  />

                  <TextField
                    label="Birthday points expiry days"
                    name="birthdayExpiryDays"
                    type="number"
                    min={0}
                    step={1}
                    autoComplete="off"
                    value={program?.birthdayExpiryDays?.toString() || '30'}
                    helpText="Number of days before birthday points expire"
                  />

                  <TextField
                    label="Minimum days before birthday"
                    name="birthdayMinDays"
                    type="number"
                    min={0}
                    step={1}
                    autoComplete="off"
                    value={program?.birthdayMinDays?.toString() || '7'}
                    helpText="Customer must submit birthdate at least this many days before birthday"
                  />

                  <Box paddingBlockStart="400">
                    <Button submit variant="primary" loading={isSettingsSubmitting}>
                      Save Birthday Settings
                    </Button>
                  </Box>
                </BlockStack>
              </Form>
            </Card>
          </Box>

          {/* Tier Multipliers Section */}
          <Box paddingBlockStart="400">
            <Card>
              <Form method="post">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">Tier Multipliers</Text>
                  <Text as="p" variant="bodyMd">
                    Configure point multipliers for different customer tiers.
                  </Text>
                  <Divider />
                  
                  <Text as="h3" variant="headingMd">Bronze Tier</Text>
                  <TextField
                    label="Spend multiplier"
                    name="bronzeSpendMultiplier"
                    type="number"
                    min={0}
                    step={0.1}
                    autoComplete="off"
                    value={program?.bronzeSpendMultiplier?.toString() || '1.0'}
                    helpText="Multiplier applied to points earned from purchases"
                  />
                  <TextField
                    label="Review multiplier"
                    name="bronzeReviewMultiplier"
                    type="number"
                    min={0}
                    step={0.1}
                    autoComplete="off"
                    value={program?.bronzeReviewMultiplier?.toString() || '1.0'}
                    helpText="Multiplier applied to points earned from reviews"
                  />

                  <Text as="h3" variant="headingMd">Silver Tier</Text>
                  <TextField
                    label="Spend multiplier"
                    name="silverSpendMultiplier"
                    type="number"
                    min={0}
                    step={0.1}
                    autoComplete="off"
                    value={program?.silverSpendMultiplier?.toString() || '1.25'}
                    helpText="Multiplier applied to points earned from purchases"
                  />
                  <TextField
                    label="Review multiplier"
                    name="silverReviewMultiplier"
                    type="number"
                    min={0}
                    step={0.1}
                    autoComplete="off"
                    value={program?.silverReviewMultiplier?.toString() || '1.5'}
                    helpText="Multiplier applied to points earned from reviews"
                  />

                  <Text as="h3" variant="headingMd">Gold Tier</Text>
                  <TextField
                    label="Spend multiplier"
                    name="goldSpendMultiplier"
                    type="number"
                    min={0}
                    step={0.1}
                    autoComplete="off"
                    value={program?.goldSpendMultiplier?.toString() || '1.5'}
                    helpText="Multiplier applied to points earned from purchases"
                  />
                  <TextField
                    label="Review multiplier"
                    name="goldReviewMultiplier"
                    type="number"
                    min={0}
                    step={0.1}
                    autoComplete="off"
                    value={program?.goldReviewMultiplier?.toString() || '2.0'}
                    helpText="Multiplier applied to points earned from reviews"
                  />

                  <Box paddingBlockStart="400">
                    <Button submit variant="primary" loading={isSettingsSubmitting}>
                      Save Tier Multipliers
                    </Button>
                  </Box>
                </BlockStack>
              </Form>
            </Card>
          </Box>

          {/* Tier Qualification Section */}
          <Box paddingBlockStart="400">
            <Card>
              <Form method="post">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">Tier Qualification Rules</Text>
                  <Text as="p" variant="bodyMd">
                    Configure lifetime point thresholds for each tier.
                  </Text>
                  <Divider />
                  
                  <TextField
                    label="Bronze tier threshold (lifetime points)"
                    name="bronzeThreshold"
                    type="number"
                    min={0}
                    step={1}
                    autoComplete="off"
                    value={program?.bronzeThreshold?.toString() || '0'}
                    helpText="Lifetime points needed for Bronze tier (default entry tier)"
                  />

                  <TextField
                    label="Silver tier threshold (lifetime points)"
                    name="silverThreshold"
                    type="number"
                    min={0}
                    step={1}
                    autoComplete="off"
                    value={program?.silverThreshold?.toString() || '2000'}
                    helpText="Lifetime points needed for Silver tier"
                  />

                  <TextField
                    label="Gold tier threshold (lifetime points)"
                    name="goldThreshold"
                    type="number"
                    min={0}
                    step={1}
                    autoComplete="off"
                    value={program?.goldThreshold?.toString() || '5000'}
                    helpText="Lifetime points needed for Gold tier"
                  />

                  <Box paddingBlockStart="400">
                    <Button submit variant="primary" loading={isSettingsSubmitting}>
                      Save Tier Qualification
                    </Button>
                  </Box>
                </BlockStack>
              </Form>
            </Card>
          </Box>

          {/* Redemption Rules Section */}
          <Box paddingBlockStart="400">
            <Card>
              <Form method="post">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">Redemption Rules</Text>
                  <Text as="p" variant="bodyMd">
                    Configure how customers can redeem their points.
                  </Text>
                  <Divider />
                  
                  <TextField
                    label={`Conversion rate: ${currency} per 100 points`}
                    name="redemptionValue"
                    type="number"
                    min={0}
                    step={0.01}
                    autoComplete="off"
                    value={program?.redemptionValue?.toString() || '5'}
                    helpText={`How many ${currency} customers get for every 100 points`}
                  />

                  <TextField
                    label="Minimum redemption points"
                    name="minRedemption"
                    type="number"
                    min={0}
                    step={1}
                    autoComplete="off"
                    value={program?.minRedemption?.toString() || '100'}
                    helpText="Minimum points required for redemption"
                  />

                  <div style={{ margin: '1rem 0' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        name="preventStacking"
                        defaultChecked={program?.preventStacking || false}
                        style={{ width: '1rem', height: '1rem' }}
                      />
                      <Text as="span" variant="bodyMd">Prevent stacking with manual discount codes</Text>
                    </label>
                    <Text as="p" variant="bodySm" tone="subdued">
                      When enabled, point redemptions cannot be combined with other discount codes
                    </Text>
                  </div>

                  <Box paddingBlockStart="400">
                    <Button submit variant="primary" loading={isSettingsSubmitting}>
                      Save Redemption Rules
                    </Button>
                  </Box>
                </BlockStack>
              </Form>
            </Card>
          </Box>

          {/* Points Expiration Section */}
          <Box paddingBlockStart="400">
            <Card>
              <Form method="post">
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">Points Expiration Rules</Text>
                  <Text as="p" variant="bodyMd">
                    Configure when points expire due to inactivity.
                  </Text>
                  <Divider />
                  
                  <TextField
                    label="Points expire after (months of inactivity)"
                    name="pointsExpiryMonths"
                    type="number"
                    min={0}
                    step={1}
                    autoComplete="off"
                    value={program?.pointsExpiryMonths?.toString() || '12'}
                    helpText="Points expire after this many months without a successful purchase"
                  />

                  <Box paddingBlockStart="400">
                    <Button submit variant="primary" loading={isSettingsSubmitting}>
                      Save Expiration Rules
                    </Button>
                  </Box>
                </BlockStack>
              </Form>
            </Card>
          </Box>
          
          {/* Point Rules Section */}
          <Box paddingBlockStart="400">
            <Card>
              <Form method="post">
                <input type="hidden" name="_action" value="updatePointRules" />
                <BlockStack gap="400">
                  <Text as="h2" variant="headingLg">Point Rules</Text>
                  <Text as="p" variant="bodyMd">
                    Configure how customers can earn points in your loyalty program.
                  </Text>
                  <Divider />
                  
                  <DataTable
                    columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                    headings={['Rule', 'Points', 'Description', 'Status', 'Actions']}
                    rows={pointRules
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((rule, index) => [
                      PointRuleTypeLabels[rule.type],
                      (
                        <TextField
                          label=""
                          labelHidden
                          type="number"
                          min={0}
                          name={`rule_${rule.type}_points`}
                          value={rule.points.toString()}
                          autoComplete="off"
                        />
                      ),
                      (
                        <TextField
                          label=""
                          labelHidden
                          name={`rule_${rule.type}_description`}
                          value={rule.description}
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
                          <Form method="post">
                            <input type="hidden" name="_action" value="toggleRule" />
                            <input type="hidden" name="ruleId" value={rule.id} />
                            <input type="hidden" name="currentActive" value={rule.isActive.toString()} />
                            <Button
                              size="slim"
                              submit
                              variant={rule.isActive ? 'secondary' : 'primary'}
                            >
                              {rule.isActive ? 'Deactivate' : 'Activate'}
                            </Button>
                          </Form>
                          <ButtonGroup>
                            <Form method="post">
                              <input type="hidden" name="_action" value="moveRuleUp" />
                              <input type="hidden" name="ruleId" value={rule.id} />
                              <input type="hidden" name="currentSortOrder" value={rule.sortOrder} />
                              <Button
                                size="slim"
                                submit
                                disabled={index === 0}
                                icon={<Icon source={ArrowUpIcon} />}
                              />
                            </Form>
                            <Form method="post">
                              <input type="hidden" name="_action" value="moveRuleDown" />
                              <input type="hidden" name="ruleId" value={rule.id} />
                              <input type="hidden" name="currentSortOrder" value={rule.sortOrder} />
                              <Button
                                size="slim"
                                submit
                                disabled={index === pointRules.length - 1}
                                icon={<Icon source={ArrowDownIcon} />}
                              />
                            </Form>
                          </ButtonGroup>
                        </InlineStack>
                      )
                    ])}
                  />
                  
                  {pointRules.map(rule => (
                    <input 
                      key={rule.id}
                      type="hidden" 
                      name={`rule_${rule.type}_sortOrder`} 
                      value={rule.sortOrder} 
                    />
                  ))}
                  
                  <Box paddingBlockStart="400">
                    <Button submit variant="primary" loading={isPointRulesSubmitting}>
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