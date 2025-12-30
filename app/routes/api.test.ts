// app/routes/api.test-proxy.ts
import { json } from '@remix-run/node';
import type { ActionFunctionArgs } from '@remix-run/node';

export async function action({ request }: ActionFunctionArgs) {
  try {
    const body = await request.json();

    console.log('✅ App Proxy request received:', body);

    if (!body.testData) {
      return json({ error: 'Missing testData' }, { status: 400 });
    }

    const url = new URL(request.url);

    return json({
      success: true,
      message: 'App Proxy is working!',
      receivedData: body.testData,
      shop: url.searchParams.get('shop'),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Proxy error:', error);

    return json(
      {
        error: 'Internal server error',
      },
      { status: 500 }
    );
  }
}
