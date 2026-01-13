// app/routes/auth.login/route.tsx
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import {
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));
  return { 
    errors, 
    polarisTranslations,
    // Get shop from URL params if present
    shop: new URL(request.url).searchParams.get("shop") || ""
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const shop = formData.get("shop") as string;
  const errors = loginErrorMessage(await login(request));

  if (errors) {
    return { errors, shop };
  }

  return null;
};

export default function Auth() {
  const { errors, shop, polarisTranslations } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const currentErrors = actionData?.errors || errors;

  return (
    <Page>
      <Card>
        <Form method="post">
          <FormLayout>
            <Text variant="headingMd" as="h2">
              Log in
            </Text>
            <TextField
              type="text"
              name="shop"
              label="Shop domain"
              helpText="example.myshopify.com"
              value={actionData?.shop || shop}
              autoComplete="on"
              error={currentErrors?.shop}
            />
            <Button submit>Log in</Button>
          </FormLayout>
        </Form>
      </Card>
    </Page>
  );
}