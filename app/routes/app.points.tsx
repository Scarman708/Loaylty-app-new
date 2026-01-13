import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Form, useLoaderData, useSearchParams } from '@remix-run/react';
import { authenticate } from '../shopify.server';
import { Prisma } from '@prisma/client';
import db from '../db.server';

interface CustomerPoints {
  id: string;
  name: string;
  email: string;
  points: number;
  lifetimePoints: number;
  lastEarnedAt?: string | null;
  joinedAt?: string | null;
  status: string;
  shopCustomerId: string;
  createdAt: string;
  updatedAt: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const search = url.searchParams.get('search') || '';
  const status = url.searchParams.get('status') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const perPage = 10;

  try {
    
    const [customers, total] = await Promise.all([
  db.customer.findMany({
    where: {
      shopId: 1, // Make sure to set the correct shopId
      ...(search && {
        OR: [
          { email: { contains: search } },
          { shopifyId: { contains: search } },
        ].filter(Boolean),
      }),
      ...(status && { status }),
    },
    skip: (page - 1) * perPage,
    take: perPage,
    orderBy: { pointBalance: 'desc' },
    select: {
      id: true,
      email: true,
      pointBalance: true,  // Changed from points to pointBalance
      lifetimePoints: true,
      lastEarnedAt: true,
      shopCustomerId: true,
      createdAt: true,
      updatedAt: true,
      shopId: true,
      // Removed firstName and lastName as they're not in the Customer model
      // Added other fields from your Customer model
      acceptsMarketing: true,
      birthday: true,
      currentTierId: true,
      referralCode: true,
      referredByCode: true,
    },
  }),
  db.customer.count({
    where: {
      shopId: 1, // Same shopId as above
      ...(search && {
        OR: [
          { email: { contains: search } },
          { shopifyId: { contains: search } },
        ].filter(Boolean),
      }),
      ...(status && { status }),
    },
  }),
]);

    return json({
      customers,
      pagination: {
        total,
        page,
        perPage,
        totalPages: Math.ceil(total / perPage),
      },
    });
  } catch (error) {
    console.error('Error loading customer points:', error);
    return json(
      { error: 'Failed to load customer points' },
      { status: 500 }
    );
  }
}

export default function CustomerPointsPage() {
  const data = useLoaderData<typeof loader>();
  const customers = 'error' in data ? [] : data.customers;
  const pagination = 'error' in data ? { total: 0, page: 1, perPage: 10, totalPages: 1 } : data.pagination;
  const error = 'error' in data ? data.error : undefined;
  const [searchParams] = useSearchParams();
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Customer Points</title>
        <link href="https://unpkg.com/tailwindcss@^2.0.0/dist/tailwind.min.css" rel="stylesheet">
        <style>
          .pagination { display: flex; justify-content: center; gap: 0.5rem; margin-top: 1rem; }
          .pagination a, .pagination span { padding: 0.5rem 1rem; border: 1px solid #e2e8f0; border-radius: 0.25rem; }
          .pagination .active { background-color: #3b82f6; color: white; border-color: #3b82f6; }
          .pagination a:not(.active):hover { background-color: #f8fafc; }
        </style>
      </head>
      <body class="bg-gray-50 min-h-screen">
        <div class="container mx-auto px-4 py-8">
          <h1 class="text-2xl font-bold mb-6">Customer Points</h1>
          
          <div class="bg-white rounded-lg shadow p-6 mb-6">
            <Form method="get" class="flex flex-col md:flex-row gap-4 items-end">
              <div class="flex-1 w-full">
                <label class="block text-sm font-medium text-gray-700 mb-1">Search</label>
                <input
                  type="text"
                  name="search"
                  value="${search}"
                  placeholder="Search by name or email..."
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div class="w-full md:w-48">
                <label class="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <select
                  name="status"
                  class="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="" ${!status ? 'selected' : ''}>All Statuses</option>
                  <option value="active" ${status === 'active' ? 'selected' : ''}>Active</option>
                  <option value="inactive" ${status === 'inactive' ? 'selected' : ''}>Inactive</option>
                </select>
              </div>
              <button
                type="submit"
                class="w-full md:w-auto px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Apply Filters
              </button>
            </Form>
          </div>

          ${error ? `
            <div class="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
              <div class="flex">
                <div class="flex-shrink-0">
                  <svg class="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
                  </svg>
                </div>
                <div class="ml-3">
                  <p class="text-sm text-red-700">${error}</p>
                </div>
              </div>
            </div>` : ''}

          <div class="bg-white shadow overflow-hidden sm:rounded-lg">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                  <tr>
                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Points</th>
                    <th scope="col" class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Lifetime Points</th>
                    <th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Activity</th>
                  </tr>
                </thead>
                <tbody class="bg-white divide-y divide-gray-200">
                  ${customers.map((customer: any) => `
                    <tr class="hover:bg-gray-50">
                      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${escapeHtml(customer.name)}</td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${escapeHtml(customer.email)}</td>
                      <td class="px-6 py-4 whitespace-nowrap">
                        <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          customer.status === 'active' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-yellow-100 text-yellow-800'
                        }">
                          ${customer.status}
                        </span>
                      </td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">${customer.points.toLocaleString()}</td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">${customer.lifetimePoints.toLocaleString()}</td>
                      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${
                        customer.lastEarnedAt 
                          ? new Date(customer.lastEarnedAt).toLocaleDateString() 
                          : 'Never'
                      }</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>

            ${pagination.totalPages > 1 ? `
              <div class="px-6 py-4 border-t border-gray-200">
                <div class="flex items-center justify-between">
                  <div class="text-sm text-gray-700">
                    Showing <span class="font-medium">${(pagination.page - 1) * pagination.perPage + 1}</span> to 
                    <span class="font-medium">${Math.min(pagination.page * pagination.perPage, pagination.total)}</span> of{' '}
                    <span class="font-medium">${pagination.total}</span> results
                  </div>
                  <div class="pagination">
                    ${pagination.page > 1 ? `
                      <a href="?${new URLSearchParams({
                        ...(search ? { search } : {}),
                        ...(status ? { status } : {}),
                        page: (pagination.page - 1).toString(),
                      })}" class="page-link">Previous</a>
                    ` : '<span class="opacity-50 cursor-not-allowed">Previous</span>'}
                    
                    ${Array.from({ length: pagination.totalPages }, (_, i) => i + 1).map(p => `
                      <a href="?${new URLSearchParams({
                        ...(search ? { search } : {}),
                        ...(status ? { status } : {}),
                        page: p.toString(),
                      })}" class="page-link ${p === pagination.page ? 'active' : ''}">${p}</a>
                    `).join('')}
                    
                    ${pagination.page < pagination.totalPages ? `
                      <a href="?${new URLSearchParams({
                        ...(search ? { search } : {}),
                        ...(status ? { status } : {}),
                        page: (pagination.page + 1).toString(),
                      })}" class="page-link">Next</a>
                    ` : '<span class="opacity-50 cursor-not-allowed">Next</span>'}
                  </div>
                </div>
              </div>` : ''}
          </div>
        </div>
      </body>
    </html>
  `;
}

// Helper function to escape HTML
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}