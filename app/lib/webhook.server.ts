import crypto from "crypto";

/**
 * Verify Shopify Webhook HMAC
 *
 * @param request - The incoming Request object
 * @param secret - The Shopify API Secret Key
 * @returns boolean - True if the HMAC is valid
 */
export async function verifyWebhookHMAC(
    request: Request,
    secret: string
): Promise<boolean> {
    try {
        const hmacHeader = request.headers.get("X-Shopify-Hmac-Sha256");

        if (!hmacHeader) {
            console.error("Missing X-Shopify-Hmac-Sha256 header");
            return false;
        }

        // Clone the request to read body without consuming the original stream if possible,
        // but in Remix action/loaders, we usually consume it.
        // However, to compute HMAC we need the raw body.
        // Note: If the body is already consumed before this, it will fail.
        // In typical usage, this should be called before parsing JSON.
        const payload = await request.clone().text();

        const digest = crypto
            .createHmac("sha256", secret)
            .update(payload, "utf8")
            .digest("base64");

        // Timing safe compare to prevent timing attacks
        const a = Buffer.from(digest);
        const b = Buffer.from(hmacHeader);

        if (a.length !== b.length) {
            return false;
        }

        return crypto.timingSafeEqual(a, b);
    } catch (error) {
        console.error("Error verifying webhook HMAC:", error);
        return false;
    }
}

/**
 * Register all app webhooks via Admin API
 * This ensures webhooks are registered even if not defined in shopify.app.toml
 */
interface AdminClient {
    graphql: (query: string, variables?: Record<string, any>) => Promise<Response>;
}

const WEBHOOK_REGISTRATION_MUTATION = `#graphql
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $url: String!) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: { callbackUrl: $url, format: JSON }
    ) {
      webhookSubscription {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function registerAppWebhooks(
    admin: AdminClient,
    appUrl: string
): Promise<void> {
    const webhooks = [
        { topic: "APP_UNINSTALLED", endpoint: "/webhooks/app/uninstalled" },
        { topic: "CUSTOMERS_DATA_REQUEST", endpoint: "/webhooks/customers/data_request" },
        { topic: "CUSTOMERS_REDACT", endpoint: "/webhooks/customers/redact" },
        { topic: "SHOP_REDACT", endpoint: "/webhooks/shop/redact" },
    ];


    for (const hook of webhooks) {
        try {
            const callbackUrl = `${appUrl}${hook.endpoint}`;

            const response = await admin.graphql(WEBHOOK_REGISTRATION_MUTATION, {
                variables: {
                    topic: hook.topic,
                    url: callbackUrl,
                },
            });

            const json = await response.json();

            if (json.data?.webhookSubscriptionCreate?.userErrors?.length > 0) {
                // Ignore "Address is already taken" errors as they mean it's already registered
                const errors = json.data.webhookSubscriptionCreate.userErrors;
                const isDuplicate = errors.some((e: any) => e.message.includes("already taken"));

                if (!isDuplicate) {
                    console.warn(
                        `Failed to register webhook ${hook.topic}:`,
                        JSON.stringify(errors)
                    );
                }
                // else: duplicate webhook, already registered
            }
            // else: no errors, success

        } catch (error) {
            console.error(`Error registering webhook ${hook.topic}:`, error);
        }
    }
}
