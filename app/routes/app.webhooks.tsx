import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "~/shopify.server";
import { Page, Card, Layout } from "@shopify/polaris";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const authResult = await authenticate.admin(request);

  if (!authResult) {
    // Not an admin-authenticated request
    throw redirect("/auth/login");
  }

  const { admin } = authResult;

  const response = await admin.graphql(`
    query GetWebhooks {
      webhookSubscriptions(first: 50) {
        edges {
          node {
            id
            topic
            endpoint {
              __typename
              ... on WebhookHttpEndpoint {
                callbackUrl
              }
            }
          }
        }
      }
    }
  `);

  const data = await response.json();

  return json({
    webhooks: data.data.webhookSubscriptions.edges,
  });
};

export default function WebhooksPage() {
  const { webhooks } = useLoaderData<typeof loader>();

  return (
    <Page title="Registered Webhooks">
      <Layout>
        <Layout.Section>
          <Card>
            <ul style={{ margin: 0, paddingLeft: "1rem" }}>
              {webhooks.map((edge: any) => (
                <li key={edge.node.id}>
                  <strong>{edge.node.topic}</strong>
                  {" – "}
                  {edge.node.endpoint?.callbackUrl ?? "—"}
                </li>
              ))}
            </ul>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
