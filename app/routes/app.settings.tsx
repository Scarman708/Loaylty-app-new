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
          pointsPerCurrency: 1,
          minOrderValueCents: 1000,
          pointsPerReview: 50,
          maxReviewsPerMonth: 2,
          welcomeBonusBronze: 100,
          welcomeBonusSilver: 300,
          welcomeBonusGold: 500,
          birthdayPoints: 200,
          birthdayMinLeadDays: 7,
          pointsPerDollar: 100,
          minRedemptionPoints: 100,
          preventDiscountStacking: false,
          pointsExpiryMonths: 12,
          rounding: 'nearest',
          minSubtotalCents: 0,
          earnOnShipping: false,
          excludeDiscounts: true,
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
  const redemptionPointsPerDollar = formData.get('redemptionPointsPerDollar');
  
  const settings = {
    pointsPerCurrency: pointsPerDollar ? Number(pointsPerDollar) : 1,
    minOrderValueCents: minOrderValue ? Math.round(Number(minOrderValue) * 100) : 1000,
    pointsPerReview: formData.get('pointsPerReview') ? Number(formData.get('pointsPerReview')) : 50,
    maxReviewsPerMonth: formData.get('maxReviewsPerMonth') ? Number(formData.get('maxReviewsPerMonth')) : 2,
    welcomeBonusBronze: formData.get('welcomeBonusBronze') ? Number(formData.get('welcomeBonusBronze')) : 100,
    welcomeBonusSilver: formData.get('welcomeBonusSilver') ? Number(formData.get('welcomeBonusSilver')) : 300,
    welcomeBonusGold: formData.get('welcomeBonusGold') ? Number(formData.get('welcomeBonusGold')) : 500,
    birthdayPoints: formData.get('birthdayPoints') ? Number(formData.get('birthdayPoints')) : 200,
    birthdayMinLeadDays: formData.get('birthdayMinLeadDays') ? Number(formData.get('birthdayMinLeadDays')) : 7,
    pointsPerDollar: redemptionPointsPerDollar ? Number(redemptionPointsPerDollar) : 100,
    minRedemptionPoints: formData.get('minRedemptionPoints') ? Number(formData.get('minRedemptionPoints')) : 100,
    preventDiscountStacking: formData.get('preventDiscountStacking') === 'on',
    pointsExpiryMonths: formData.get('pointsExpiryMonths') ? Number(formData.get('pointsExpiryMonths')) : 12,
    earnOnShipping: formData.get('earnOnShipping') === 'on',
    excludeDiscounts: formData.get('excludeDiscounts') === 'on',
    rounding: (formData.get('rounding') as RoundingMode) || 'nearest',
    maxPointsPerOrder: formData.get('maxPointsPerOrder') ? Number(formData.get('maxPointsPerOrder')) : null,
    dailyEarnCap: formData.get('dailyEarnCap') ? Number(formData.get('dailyEarnCap')) : null,
    monthlyEarnCap: formData.get('monthlyEarnCap') ? Number(formData.get('monthlyEarnCap')) : null,
  };

  const errors: Record<string, string> = {};
  if (isNaN(settings.pointsPerCurrency) || settings.pointsPerCurrency <= 0) {
    errors.pointsPerCurrency = 'Points per currency must be a positive number';
  }
  if (isNaN(settings.minOrderValueCents) || settings.minOrderValueCents < 0) {
    errors.minOrderValue = 'Minimum order value cannot be negative';
  }

  if (Object.keys(errors).length > 0) {
    return json({ errors }, { status: 400 });
  }

  await db.programSettings.upsert({
    where: { shopId: shop.id },
    update: {
      pointsPerCurrency: settings.pointsPerCurrency,
      minOrderValueCents: settings.minOrderValueCents,
      pointsPerReview: settings.pointsPerReview,
      maxReviewsPerMonth: settings.maxReviewsPerMonth,
      welcomeBonusBronze: settings.welcomeBonusBronze,
      welcomeBonusSilver: settings.welcomeBonusSilver,
      welcomeBonusGold: settings.welcomeBonusGold,
      birthdayPoints: settings.birthdayPoints,
      birthdayMinLeadDays: settings.birthdayMinLeadDays,
      pointsPerDollar: settings.pointsPerDollar,
      minRedemptionPoints: settings.minRedemptionPoints,
      preventDiscountStacking: settings.preventDiscountStacking,
      pointsExpiryMonths: settings.pointsExpiryMonths,
      earnOnShipping: settings.earnOnShipping,
      excludeDiscounts: settings.excludeDiscounts,
      rounding: settings.rounding,
      maxPointsPerOrder: settings.maxPointsPerOrder,
      dailyEarnCap: settings.dailyEarnCap,
      monthlyEarnCap: settings.monthlyEarnCap,
    },
    create: {
      shopId: shop.id,
      pointsPerCurrency: settings.pointsPerCurrency,
      minOrderValueCents: settings.minOrderValueCents,
      pointsPerReview: settings.pointsPerReview,
      maxReviewsPerMonth: settings.maxReviewsPerMonth,
      welcomeBonusBronze: settings.welcomeBonusBronze,
      welcomeBonusSilver: settings.welcomeBonusSilver,
      welcomeBonusGold: settings.welcomeBonusGold,
      birthdayPoints: settings.birthdayPoints,
      birthdayMinLeadDays: settings.birthdayMinLeadDays,
      pointsPerDollar: settings.pointsPerDollar,
      minRedemptionPoints: settings.minRedemptionPoints,
      preventDiscountStacking: settings.preventDiscountStacking,
      pointsExpiryMonths: settings.pointsExpiryMonths,
      earnOnShipping: settings.earnOnShipping,
      excludeDiscounts: settings.excludeDiscounts,
      rounding: settings.rounding,
      maxPointsPerOrder: settings.maxPointsPerOrder,
      dailyEarnCap: settings.dailyEarnCap,
      monthlyEarnCap: settings.monthlyEarnCap,
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
    <input type="hidden" name="_action" value="updateSettings" /> {/* Add this */}
    <BlockStack gap="400">
      <Text as="h2" variant="headingLg">Points Configuration</Text>
      <Divider />
      
      <TextField
        label={`Points per ${currency} spent`}
        name="pointsPerCurrency" 
        type="number"
        min={1}
        step={1}
        autoComplete="off"
        value={program?.pointsPerCurrency?.toString() || '100'}
        error={actionData && 'errors' in actionData ? actionData.errors?.pointsPerCurrency : undefined}
        helpText={`Customers will earn this many points for each ${currency} spent`}
      />

      <TextField
        label="Minimum order value to earn points"
        name="minOrderValue" 
        type="number"
        min={0}
        step={0.01}
        autoComplete="off"
        value={program?.minOrderValueCents ? (program.minOrderValueCents / 100).toFixed(2) : '10.00'}
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

      <Divider />
      
      <Text as="h3" variant="headingMd">Review Settings</Text>
      
      <TextField
        label="Points per review"
        name="pointsPerReview"
        type="number"
        min={0}
        step={1}
        autoComplete="off"
        value={program?.pointsPerReview?.toString() || '50'}
        helpText="Points awarded for each verified review"
      />

      <TextField
        label="Maximum reviews per month"
        name="maxReviewsPerMonth"
        type="number"
        min={0}
        step={1}
        autoComplete="off"
        value={program?.maxReviewsPerMonth?.toString() || '2'}
        helpText="Maximum number of reviews that can earn points per month"
      />

      <Divider />
      
      <Text as="h3" variant="headingMd">Welcome Bonuses</Text>
      
      <TextField
        label="Bronze welcome bonus"
        name="welcomeBonusBronze"
        type="number"
        min={0}
        step={1}
        autoComplete="off"
        value={program?.welcomeBonusBronze?.toString() || '100'}
        helpText="Points awarded when customer signs up (Bronze tier)"
      />

      <TextField
        label="Silver welcome bonus"
        name="welcomeBonusSilver"
        type="number"
        min={0}
        step={1}
        autoComplete="off"
        value={program?.welcomeBonusSilver?.toString() || '300'}
        helpText="Points awarded when customer reaches Silver tier"
      />

      <TextField
        label="Gold welcome bonus"
        name="welcomeBonusGold"
        type="number"
        min={0}
        step={1}
        autoComplete="off"
        value={program?.welcomeBonusGold?.toString() || '500'}
        helpText="Points awarded when customer reaches Gold tier"
      />

      <Divider />
      
      <Text as="h3" variant="headingMd">Birthday Rewards</Text>
      
      <TextField
        label="Birthday points"
        name="birthdayPoints"
        type="number"
        min={0}
        step={1}
        autoComplete="off"
        value={program?.birthdayPoints?.toString() || '200'}
        helpText="Points awarded on customer's birthday"
      />

      <TextField
        label="Birthday lead days"
        name="birthdayMinLeadDays"
        type="number"
        min={0}
        step={1}
        autoComplete="off"
        value={program?.birthdayMinLeadDays?.toString() || '7'}
        helpText="Minimum days before birthday to submit birthdate"
      />

      <Divider />
      
      <Text as="h3" variant="headingMd">Redemption Settings</Text>
      
      <TextField
        label="Points to currency ratio"
        name="pointsPerDollar" 
        type="number"
        min={1}
        step={1}
        autoComplete="off"
        value={program?.pointsPerDollar?.toString() || '100'}
        helpText={`Number of points equal to 1 ${currency}`}
      />

      <TextField
        label="Minimum redemption points"
        name="minRedemptionPoints"
        type="number"
        min={0}
        step={1}
        autoComplete="off"
        value={program?.minRedemptionPoints?.toString() || '100'}
        helpText="Minimum points required for redemption"
      />

      <div style={{ margin: '1rem 0' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            name="preventDiscountStacking"
            defaultChecked={program?.preventDiscountStacking || false}
            style={{ width: '1rem', height: '1rem' }}
          />
          <Text as="span" variant="bodyMd">Prevent stacking with discount codes</Text>
        </label>
        <Text as="p" variant="bodySm" tone="subdued">
          When enabled, loyalty discounts cannot be combined with other discount codes
        </Text>
      </div>

      <Divider />
      
      <Text as="h3" variant="headingMd">Point Expiration</Text>
      
      <TextField
        label="Points expire after (months)"
        name="pointsExpiryMonths"
        type="number"
        min={0}
        step={1}
        autoComplete="off"
        value={program?.pointsExpiryMonths?.toString() || '12'}
        helpText="Points will expire after this many months of inactivity"
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
            defaultChecked={program?.excludeDiscounts || false}
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
          
          {/* Point Rules Section
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
          </Box> */}

          {/* Tier Configuration Section */}
          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingLg">Tier Configuration</Text>
                <Text as="p" variant="bodyMd">
                  Configure loyalty tiers and their multipliers. Tiers are automatically assigned based on lifetime points.
                </Text>
                <Divider />
                
                
              </BlockStack>
            </Card>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}