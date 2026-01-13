/**
 * Shopify Billing API Utilities
 * Handles recurring application charges for the Premium plan.
 */

import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getShopByDomain } from "./db.server";

// Define generic AdminClient interface
interface AdminClient {
    graphql: (query: string, variables?: Record<string, any>) => Promise<Response>;
}

export const PLAN_NAME = "AnnounceFlow Premium";
export const PLAN_PRICE = 99.00;
export const CURRENCY_CODE = "USD";

// GraphQL Mutations & Queries
const APP_SUBSCRIPTION_CREATE = `#graphql
  mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $amount: Decimal!) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: true
      lineItems: [{
        plan: {
          appRecurringPricingDetails: {
            price: { amount: $amount, currencyCode: USD }
            interval: EVERY_30_DAYS
          }
        }
      }]
    ) {
      appSubscription {
        id
        status
      }
      confirmationUrl
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * Create a new recurring subscription
 */
export async function createSubscription(
    admin: AdminClient,
    returnUrl: string
): Promise<string> {
    const response = await admin.graphql(APP_SUBSCRIPTION_CREATE, {
        variables: {
            name: PLAN_NAME,
            returnUrl,
            amount: PLAN_PRICE,
        },
    });

    const responseJson = await response.json();
    const data = responseJson.data?.appSubscriptionCreate;

    if (data?.userErrors?.length > 0) {
        console.error("Billing error:", data.userErrors);
        throw new Error(data.userErrors.map((e: any) => e.message).join(", "));
    }

    return data.confirmationUrl;
}

/**
 * Get active subscription for the shop
 * Returns subscription if it's ACTIVE or PENDING (pending means approved but not yet activated)
 */
export async function getActiveSubscription(
    admin: AdminClient
): Promise<any | null> {
    try {
        const response = await admin.graphql(`#graphql
        query {
          appInstallation {
            activeSubscriptions {
              id
              name
              status
              test
            }
          }
        }
      `);

        const responseJson = await response.json();
        
        if (responseJson.errors) {
            console.error("GraphQL errors in getActiveSubscription:", responseJson.errors);
            return null;
        }
        
        const subscriptions = responseJson.data?.appInstallation?.activeSubscriptions || [];
        console.log(`Found ${subscriptions.length} subscriptions:`, subscriptions);

        // Find our specific plan - accept both ACTIVE and PENDING statuses
        // PENDING means the subscription was approved but may take a moment to activate
        const subscription = subscriptions.find((sub: any) => 
            (sub.status === "ACTIVE" || sub.status === "PENDING") && 
            sub.name === PLAN_NAME
        );
        
        return subscription || null;
    } catch (error) {
        console.error("Error fetching active subscription:", error);
        return null;
    }
}

/**
 * Check if shop has active premium plan in database
 */
export async function hasActivePremiumPlan(shopDomain: string): Promise<boolean> {
    const shop = await getShopByDomain(shopDomain);
    return shop?.plan === "PREMIUM";
}

/**
 * Middleware: Require Premium Plan
 * Throws 402 Payment Required response if not on premium
 */
export async function requirePremium(request: Request) {
    const { session } = await authenticate.admin(request);
    const shop = session.shop;

    const hasPremium = await hasActivePremiumPlan(shop);

    if (!hasPremium) {
        throw json({
            message: "Premium plan required",
            upgradeUrl: "/app/settings" // Assuming settings page has upgrade button
        }, { status: 402 });
    }

    return true;
}
