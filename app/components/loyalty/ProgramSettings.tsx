import { Form, useLoaderData, useNavigation } from '@remix-run/react';

interface ProgramSettingsProps {
  settings?: any;
  tiers?: any[];
}

export default function ProgramSettings({ settings, tiers = [] }: ProgramSettingsProps) {
  const navigation = useNavigation();
  const isSaving = navigation.state === 'submitting';

  return (
    <div className="space-y-6">
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Loyalty Program Settings</h2>
        
        <Form method="post" className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Points per {settings?.currencyCode || 'currency'} spent
              </label>
              <input
                type="number"
                name="pointsPerCurrency"
                defaultValue={settings?.pointsPerCurrency || 1}
                min="1"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Minimum order value ({settings?.currencyCode || 'currency'})
              </label>
              <input
                type="number"
                name="minOrderValueCents"
                defaultValue={settings?.minOrderValueCents ? settings.minOrderValueCents / 100 : 10}
                min="0"
                step="0.01"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Points per review
              </label>
              <input
                type="number"
                name="pointsPerReview"
                defaultValue={settings?.pointsPerReview || 50}
                min="1"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Points to {settings?.currencyCode || 'currency'} ratio (e.g., 100 points = 1.00)
              </label>
              <input
                type="number"
                name="pointsPerDollar"
                defaultValue={settings?.pointsPerDollar || 100}
                min="1"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              />
            </div>

            <div className="flex items-start">
              <div className="flex h-5 items-center">
                <input
                  id="excludeDiscounts"
                  name="excludeDiscounts"
                  type="checkbox"
                  defaultChecked={settings?.excludeDiscounts ?? true}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
              </div>
              <div className="ml-3 text-sm">
                <label htmlFor="excludeDiscounts" className="font-medium text-gray-700">
                  Exclude discounted amounts from point calculations
                </label>
              </div>
            </div>
          </div>

          <div className="pt-5">
            <div className="flex justify-end">
              <button
                type="button"
                className="rounded-md border border-gray-300 bg-white py-2 px-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="ml-3 inline-flex justify-center rounded-md border border-transparent bg-indigo-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </Form>
      </div>

      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-medium text-gray-900">Tier Settings</h2>
          <button
            type="button"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Add Tier
          </button>
        </div>

        <div className="overflow-hidden border-b border-gray-200 sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tier
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Min Points
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Spend Multiplier
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Review Multiplier
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Max Reviews/Month
                </th>
                <th className="relative px-6 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {tiers.map((tier: any) => (
                <tr key={tier.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {tier.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {tier.minPoints.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {tier.spendMultiplier}x
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {tier.reviewMultiplier}x
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {tier.maxReviewsPerMonth}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <a href="#" className="text-indigo-600 hover:text-indigo-900 mr-4">
                      Edit
                    </a>
                    <a href="#" className="text-red-600 hover:text-red-900">
                      Delete
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
