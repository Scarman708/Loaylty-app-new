import { json } from "@remix-run/node";

export const loader = async () => {
  return json({ message: "App Proxy is working!" });
};
