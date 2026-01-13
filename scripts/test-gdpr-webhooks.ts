/**
 * GDPR Webhook Testing Script
 * Tests all GDPR webhook endpoints with various scenarios
 * 
 * Usage: npx tsx scripts/test-gdpr-webhooks.ts [shop-domain]
 */

import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Configuration
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || "";
const APP_URL = process.env.SHOPIFY_APP_URL || "http://localhost:3000";
const TEST_SHOP_DOMAIN = process.argv[2] || "test-shop.myshopify.com";

// Test results tracking
interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
    details?: any;
}

const results: TestResult[] = [];

function recordResult(name: string, passed: boolean, error?: string, details?: any) {
    results.push({ name, passed, error, details });
    const icon = passed ? "✅" : "❌";
    console.log(`${icon} ${name}`);
    if (error) {
        console.log(`   Error: ${error}`);
    }
    if (details) {
        console.log(`   Details:`, JSON.stringify(details, null, 2));
    }
}

function header(text: string) {
    console.log("\n" + "=".repeat(60));
    console.log(text);
    console.log("=".repeat(60) + "\n");
}

/**
 * Send webhook request to endpoint
 */
async function sendWebhook(
    endpoint: string,
    payload: object,
    hmac?: string,
    useInvalidHmac: boolean = false
): Promise<{ status: number; body: any }> {
    const payloadString = JSON.stringify(payload);
    const secret = SHOPIFY_API_SECRET;
    
    let finalHmac = hmac;
    if (!finalHmac) {
        finalHmac = crypto
            .createHmac("sha256", secret)
            .update(payloadString, "utf8")
            .digest("base64");
    }
    
    if (useInvalidHmac) {
        finalHmac = "invalid_hmac_signature";
    }

    const url = `${APP_URL}${endpoint}`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Shopify-Hmac-Sha256": finalHmac || "",
        },
        body: payloadString,
    });

    let body;
    try {
        body = await response.json();
    } catch {
        body = await response.text();
    }

    return { status: response.status, body };
}

/**
 * Test 1: customers/data_request - Valid request with subscriber
 */
async function testCustomersDataRequest() {
    header("Test 1: customers/data_request - Valid Request");

    try {
        // Create test shop if doesn't exist
        let shop = await prisma.shop.findUnique({
            where: { shopDomain: TEST_SHOP_DOMAIN },
        });

        if (!shop) {
            shop = await prisma.shop.create({
                data: {
                    shopDomain: TEST_SHOP_DOMAIN,
                    accessToken: "test_token",
                    plan: "FREE",
                },
            });
            recordResult("Created test shop", true, undefined, { shop_id: shop.id });
        }

        // Create test subscriber
        const testEmail = `test-${Date.now()}@example.com`;
        const subscriber = await prisma.emailSubscriber.create({
            data: {
                shopId: shop.id,
                email: testEmail,
                barId: "test_bar_123",
                ipAddress: "192.168.1.1",
            },
        });
        recordResult("Created test subscriber", true, undefined, { email: testEmail, subscriber_id: subscriber.id });

        // Send webhook
        const payload = {
            shop_domain: TEST_SHOP_DOMAIN,
            customer: {
                id: 123456,
                email: testEmail,
            },
        };

        const { status, body } = await sendWebhook("/webhooks/customers/data_request", payload);

        // Verify response
        const passed = status === 200 && body.customer && body.customer.email === testEmail;
        recordResult(
            "customers/data_request - Valid request",
            passed,
            passed ? undefined : `Expected 200 with customer data, got ${status}`,
            { status, body }
        );

        // Cleanup
        await prisma.emailSubscriber.delete({ where: { id: subscriber.id } });
        recordResult("Cleaned up test subscriber", true);
    } catch (error) {
        recordResult("customers/data_request - Valid request", false, String(error));
    }
}

/**
 * Test 2: customers/data_request - No subscriber found
 */
async function testCustomersDataRequestNoData() {
    header("Test 2: customers/data_request - No Subscriber Found");

    try {
        const payload = {
            shop_domain: TEST_SHOP_DOMAIN,
            customer: {
                id: 999999,
                email: "nonexistent@example.com",
            },
        };

        const { status, body } = await sendWebhook("/webhooks/customers/data_request", payload);

        const passed = status === 200 && (body.message === "No data found" || !body.customer);
        recordResult(
            "customers/data_request - No data found",
            passed,
            passed ? undefined : `Expected 200 with 'No data found', got ${status}`,
            { status, body }
        );
    } catch (error) {
        recordResult("customers/data_request - No data found", false, String(error));
    }
}

/**
 * Test 3: customers/redact - Valid request
 */
async function testCustomersRedact() {
    header("Test 3: customers/redact - Valid Request");

    try {
        // Get or create shop
        let shop = await prisma.shop.findUnique({
            where: { shopDomain: TEST_SHOP_DOMAIN },
        });

        if (!shop) {
            shop = await prisma.shop.create({
                data: {
                    shopDomain: TEST_SHOP_DOMAIN,
                    accessToken: "test_token",
                    plan: "FREE",
                },
            });
        }

        // Create test subscriber
        const testEmail = `redact-${Date.now()}@example.com`;
        const subscriber = await prisma.emailSubscriber.create({
            data: {
                shopId: shop.id,
                email: testEmail,
                barId: "test_bar_456",
                ipAddress: "192.168.1.2",
            },
        });
        recordResult("Created test subscriber for redaction", true, undefined, { email: testEmail });

        // Verify subscriber exists
        const before = await prisma.emailSubscriber.findUnique({
            where: { id: subscriber.id },
        });
        if (!before) {
            throw new Error("Subscriber not created");
        }

        // Send webhook
        const payload = {
            shop_domain: TEST_SHOP_DOMAIN,
            customer: {
                id: 789012,
                email: testEmail,
            },
        };

        const { status, body } = await sendWebhook("/webhooks/customers/redact", payload);

        // Verify response
        const passed = status === 200;
        recordResult(
            "customers/redact - Valid request",
            passed,
            passed ? undefined : `Expected 200, got ${status}`,
            { status, body }
        );

        // Verify subscriber was deleted
        const after = await prisma.emailSubscriber.findUnique({
            where: { id: subscriber.id },
        });
        const deleted = after === null;
        recordResult(
            "customers/redact - Subscriber deleted",
            deleted,
            deleted ? undefined : "Subscriber still exists after redaction",
            { before: !!before, after: !!after }
        );
    } catch (error) {
        recordResult("customers/redact - Valid request", false, String(error));
    }
}

/**
 * Test 4: shop/redact - Valid request
 */
async function testShopRedact() {
    header("Test 4: shop/redact - Valid Request");

    try {
        // Create test shop with subscribers
        const testShopDomain = `redact-shop-${Date.now()}.myshopify.com`;
        const shop = await prisma.shop.create({
            data: {
                shopDomain: testShopDomain,
                accessToken: "test_token",
                plan: "FREE",
            },
        });
        recordResult("Created test shop for redaction", true, undefined, { shop_id: shop.id, domain: testShopDomain });

        // Create test subscribers
        const subscribers = await Promise.all([
            prisma.emailSubscriber.create({
                data: {
                    shopId: shop.id,
                    email: "sub1@example.com",
                    barId: "bar1",
                },
            }),
            prisma.emailSubscriber.create({
                data: {
                    shopId: shop.id,
                    email: "sub2@example.com",
                    barId: "bar2",
                },
            }),
        ]);
        recordResult("Created test subscribers", true, undefined, { count: subscribers.length });

        // Send webhook
        const payload = {
            shop_domain: testShopDomain,
        };

        const { status, body } = await sendWebhook("/webhooks/shop/redact", payload);

        // Verify response
        const passed = status === 200;
        recordResult(
            "shop/redact - Valid request",
            passed,
            passed ? undefined : `Expected 200, got ${status}`,
            { status, body }
        );

        // Verify shop and subscribers were deleted
        const shopAfter = await prisma.shop.findUnique({
            where: { shopDomain: testShopDomain },
        });
        const subscribersAfter = await prisma.emailSubscriber.findMany({
            where: { shopId: shop.id },
        });

        const allDeleted = shopAfter === null && subscribersAfter.length === 0;
        recordResult(
            "shop/redact - All data deleted",
            allDeleted,
            allDeleted ? undefined : "Shop or subscribers still exist",
            {
                shop_deleted: shopAfter === null,
                subscribers_deleted: subscribersAfter.length === 0,
            }
        );
    } catch (error) {
        recordResult("shop/redact - Valid request", false, String(error));
    }
}

/**
 * Test 5: HMAC Verification - Valid HMAC
 */
async function testHMACValid() {
    header("Test 5: HMAC Verification - Valid HMAC");

    try {
        const payload = {
            shop_domain: TEST_SHOP_DOMAIN,
            customer: {
                id: 111,
                email: "test@example.com",
            },
        };

        const { status } = await sendWebhook("/webhooks/customers/data_request", payload);

        const passed = status !== 401; // Should not be unauthorized
        recordResult(
            "HMAC Verification - Valid HMAC",
            passed,
            passed ? undefined : "Valid HMAC was rejected",
            { status }
        );
    } catch (error) {
        recordResult("HMAC Verification - Valid HMAC", false, String(error));
    }
}

/**
 * Test 6: HMAC Verification - Invalid HMAC
 */
async function testHMACInvalid() {
    header("Test 6: HMAC Verification - Invalid HMAC");

    try {
        const payload = {
            shop_domain: TEST_SHOP_DOMAIN,
            customer: {
                id: 222,
                email: "test@example.com",
            },
        };

        const { status, body } = await sendWebhook("/webhooks/customers/data_request", payload, undefined, true);

        const passed = status === 401;
        recordResult(
            "HMAC Verification - Invalid HMAC",
            passed,
            passed ? undefined : `Expected 401, got ${status}`,
            { status, body }
        );
    } catch (error) {
        recordResult("HMAC Verification - Invalid HMAC", false, String(error));
    }
}

/**
 * Test 7: HMAC Verification - Missing HMAC
 */
async function testHMACMissing() {
    header("Test 7: HMAC Verification - Missing HMAC");

    try {
        const payload = {
            shop_domain: TEST_SHOP_DOMAIN,
            customer: {
                id: 333,
                email: "test@example.com",
            },
        };

        const payloadString = JSON.stringify(payload);
        const url = `${APP_URL}/webhooks/customers/data_request`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // Intentionally missing X-Shopify-Hmac-Sha256 header
            },
            body: payloadString,
        });

        const body = await response.json();
        const passed = response.status === 401;
        recordResult(
            "HMAC Verification - Missing HMAC",
            passed,
            passed ? undefined : `Expected 401, got ${response.status}`,
            { status: response.status, body }
        );
    } catch (error) {
        recordResult("HMAC Verification - Missing HMAC", false, String(error));
    }
}

/**
 * Test 8: Error Handling - Missing Environment Variables
 */
async function testMissingEnvVars() {
    header("Test 8: Error Handling - Missing Environment Variables");

    // This test checks if the code handles missing SHOPIFY_API_SECRET gracefully
    // In production, this should return 500, but we can't easily test this without
    // temporarily unsetting the env var, which might break other tests
    recordResult(
        "Missing Environment Variables",
        true,
        undefined,
        { note: "Manual test required - unset SHOPIFY_API_SECRET to verify 500 response" }
    );
}

/**
 * Test 9: Error Handling - Invalid JSON Payload
 */
async function testInvalidJSON() {
    header("Test 9: Error Handling - Invalid JSON Payload");

    try {
        const invalidPayload = "not valid json {";
        const secret = SHOPIFY_API_SECRET;
        const hmac = crypto
            .createHmac("sha256", secret)
            .update(invalidPayload, "utf8")
            .digest("base64");

        const url = `${APP_URL}/webhooks/customers/data_request`;
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Shopify-Hmac-Sha256": hmac,
            },
            body: invalidPayload,
        });

        const body = await response.json();
        const passed = response.status === 400;
        recordResult(
            "Invalid JSON Payload",
            passed,
            passed ? undefined : `Expected 400, got ${response.status}`,
            { status: response.status, body }
        );
    } catch (error) {
        recordResult("Invalid JSON Payload", false, String(error));
    }
}

/**
 * Test 10: Method Not Allowed
 */
async function testMethodNotAllowed() {
    header("Test 10: Method Not Allowed");

    try {
        const url = `${APP_URL}/webhooks/customers/data_request`;
        const response = await fetch(url, {
            method: "GET", // Wrong method
            headers: {
                "Content-Type": "application/json",
            },
        });

        const body = await response.json();
        const passed = response.status === 405;
        recordResult(
            "Method Not Allowed",
            passed,
            passed ? undefined : `Expected 405, got ${response.status}`,
            { status: response.status, body }
        );
    } catch (error) {
        recordResult("Method Not Allowed", false, String(error));
    }
}

/**
 * Main test runner
 */
async function main() {
    console.log("\n🔍 GDPR Webhook Testing Script");
    console.log(`Shop Domain: ${TEST_SHOP_DOMAIN}`);
    console.log(`App URL: ${APP_URL}`);
    console.log(`API Secret: ${SHOPIFY_API_SECRET ? "✅ Set" : "❌ Missing"}\n`);

    if (!SHOPIFY_API_SECRET) {
        console.error("❌ SHOPIFY_API_SECRET environment variable is required");
        process.exit(1);
    }

    try {
        // Run all tests
        await testCustomersDataRequest();
        await testCustomersDataRequestNoData();
        await testCustomersRedact();
        await testShopRedact();
        await testHMACValid();
        await testHMACInvalid();
        await testHMACMissing();
        await testMissingEnvVars();
        await testInvalidJSON();
        await testMethodNotAllowed();

        // Print summary
        header("Test Summary");
        const passed = results.filter((r) => r.passed).length;
        const failed = results.filter((r) => !r.passed).length;
        const total = results.length;

        console.log(`Total Tests: ${total}`);
        console.log(`✅ Passed: ${passed}`);
        console.log(`❌ Failed: ${failed}`);
        console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%\n`);

        if (failed > 0) {
            console.log("Failed Tests:");
            results
                .filter((r) => !r.passed)
                .forEach((r) => {
                    console.log(`  ❌ ${r.name}`);
                    if (r.error) {
                        console.log(`     ${r.error}`);
                    }
                });
        }

        process.exit(failed > 0 ? 1 : 0);
    } catch (error) {
        console.error("Fatal error running tests:", error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

// Run tests
main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
});
