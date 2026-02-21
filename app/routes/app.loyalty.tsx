import { json, redirect, type LoaderFunction, type ActionFunction } from '@remix-run/node';
import { Link, useLoaderData } from '@remix-run/react';
import { authenticate } from '~/shopify.server';
import ProgramSettings from '~/components/loyalty/ProgramSettings';
import prisma from '~/db.server';

export const loader: LoaderFunction = async ({ request }) => {
  await authenticate.admin(request);
  const { session } = await authenticate.admin(request);
  
  const settings = await prisma.programSettings.findUnique({
    where: { shopId: session.shop as unknown as number }
  });
  
  const tiers = await prisma.tier.findMany({
    where: { shopId: session.shop as unknown as number },
    orderBy: { minPoints: 'asc' }
  });

  const url = new URL(request.url);
  return json({ 
    success: url.searchParams.has('success'),
    settings,
    tiers 
  });
};

export const action: ActionFunction = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  
  // Handle settings update
  const settingsData = {
    pointsPerCurrency: Number(formData.get('pointsPerCurrency')),
    minOrderValueCents: Math.round(Number(formData.get('minOrderValueCents')) * 100),
    pointsPerReview: Number(formData.get('pointsPerReview')),
    pointsPerDollar: Number(formData.get('pointsPerDollar')),
    excludeDiscounts: formData.get('excludeDiscounts') === 'on',
  };

  await prisma.programSettings.upsert({
    where: { shopId: session.shop as unknown as number },
    update: settingsData,
    create: { ...settingsData, shopId: session.shop as unknown as number },
  });

  return redirect('/app/loyalty?success=1');
};

export default function LoyaltySettings() {
  const { success, settings, tiers } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          <div className="border-b border-gray-200 pb-5">
            <h3 className="text-lg font-medium leading-6 text-gray-900">Loyalty Program</h3>
            <p className="mt-2 max-w-4xl text-sm text-gray-500">
              Configure your loyalty program settings and tiers.
            </p>
          </div>

          {success && (
            <div className="rounded-md bg-green-50 p-4 mt-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <CheckCircleIcon className="h-5 w-5 text-green-400" aria-hidden="true" />
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-green-800">Settings saved successfully</p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-8">
            <ProgramSettings settings={settings} tiers={tiers} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckCircleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-6 w-6"
      {...props}
    >
      <path
        fillRule="evenodd"
        d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
        clipRule="evenodd"
      />
    </svg>
  );
}
