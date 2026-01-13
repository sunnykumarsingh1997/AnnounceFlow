import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useNavigate,
  useSubmit,
  useNavigation,
  useActionData,
} from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
import {
  Page,
  Card,
  BlockStack,
  Text,
  Select,
  Button,
  InlineStack,
  Checkbox,
  Divider,
  Badge,
  Box,
  Banner,
  Modal,
  Link,
  Icon,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import {
  ExternalIcon,
  DeleteIcon,
  ExportIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import {
  getBarsConfig,
  updateGlobalSettings,
} from "../lib/metafields.server";
import {
  getShopByDomain,
  prisma,
  exportSubscribersCSV,
  deleteAllSubscribers,
} from "../lib/db.server";
import {
  hasActivePremiumPlan,
  createSubscription,
} from "../lib/billing.server";
import { ColorPicker } from "../components";
import type { GlobalSettings, BarPosition } from "../lib/types";

// Plan constants (client-side safe)
const PLAN_PRICE = 99.00;

// Types
interface LoaderData {
  isPremium: boolean;
  globalSettings: GlobalSettings;
  stats: {
    totalBars: number;
    totalSubscribers: number;
  };
  shopDomain: string;
}

interface ActionData {
  success: boolean;
  message?: string;
  error?: string;
  redirectUrl?: string;
}

// Loader function
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Check premium status
  const isPremium = await hasActivePremiumPlan(shopDomain);

  // Get global settings from metafields
  const barsConfig = await getBarsConfig(admin);

  // Get shop from database for subscriber count
  const shop = await getShopByDomain(shopDomain);

  // Get stats
  let totalSubscribers = 0;
  if (shop) {
    totalSubscribers = await prisma.emailSubscriber.count({
      where: { shopId: shop.id },
    });
  }

  return json<LoaderData>({
    isPremium,
    globalSettings: barsConfig.global_settings,
    stats: {
      totalBars: barsConfig.bars.length,
      totalSubscribers,
    },
    shopDomain,
  });
};

// Action function
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Handle subscription upgrade
  if (intent === "upgrade") {
    try {
      const returnUrl = `https://${shopDomain}/admin/apps/announceflow/app/settings?upgraded=true`;
      const confirmationUrl = await createSubscription(admin, returnUrl);
      return json<ActionData>({
        success: true,
        redirectUrl: confirmationUrl,
      });
    } catch (error) {
      console.error("Error creating subscription:", error);
      return json<ActionData>(
        {
          success: false,
          error: "Failed to create subscription. Please try again.",
        },
        { status: 500 }
      );
    }
  }

  // Handle settings save
  if (intent === "save") {
    const defaultPosition = formData.get("defaultPosition") as BarPosition;
    const defaultBgColor = formData.get("defaultBgColor") as string;
    const defaultTextColor = formData.get("defaultTextColor") as string;
    const showBranding = formData.get("showBranding") === "true";

    try {
      const result = await updateGlobalSettings(admin, {
        default_position: defaultPosition,
        default_bg_color: defaultBgColor,
        default_text_color: defaultTextColor,
        show_branding: showBranding,
      });

      if (result.success) {
        return json<ActionData>({
          success: true,
          message: "Settings saved successfully",
        });
      }

      return json<ActionData>(
        {
          success: false,
          error: result.errors?.join(", ") || "Failed to save settings",
        },
        { status: 500 }
      );
    } catch (error) {
      console.error("Error saving settings:", error);
      return json<ActionData>(
        { success: false, error: "Failed to save settings" },
        { status: 500 }
      );
    }
  }

  // Handle data export
  if (intent === "export") {
    try {
      const shop = await getShopByDomain(shopDomain);
      if (!shop) {
        return json<ActionData>(
          { success: false, error: "Shop not found" },
          { status: 404 }
        );
      }

      const csv = await exportSubscribersCSV(shop.id);
      return json({ success: true, csv });
    } catch (error) {
      console.error("Error exporting data:", error);
      return json<ActionData>(
        { success: false, error: "Failed to export data" },
        { status: 500 }
      );
    }
  }

  // Handle data deletion
  if (intent === "delete-all") {
    try {
      const shop = await getShopByDomain(shopDomain);
      if (!shop) {
        return json<ActionData>(
          { success: false, error: "Shop not found" },
          { status: 404 }
        );
      }

      await deleteAllSubscribers(shop.id);
      return json<ActionData>({
        success: true,
        message: "All subscriber data deleted successfully",
      });
    } catch (error) {
      console.error("Error deleting data:", error);
      return json<ActionData>(
        { success: false, error: "Failed to delete data" },
        { status: 500 }
      );
    }
  }

  return json<ActionData>(
    { success: false, error: "Unknown action" },
    { status: 400 }
  );
};

export default function Settings() {
  const { isPremium, globalSettings, stats, shopDomain } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();

  // Form state
  const [defaultPosition, setDefaultPosition] = useState<BarPosition>(
    globalSettings.default_position || "top"
  );
  const [defaultBgColor, setDefaultBgColor] = useState(
    globalSettings.default_bg_color || "#000000"
  );
  const [defaultTextColor, setDefaultTextColor] = useState(
    globalSettings.default_text_color || "#FFFFFF"
  );
  const [showBranding, setShowBranding] = useState(
    globalSettings.show_branding !== false
  );

  // Modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Loading states
  const isSubmitting = navigation.state === "submitting";
  const isSaving =
    isSubmitting && navigation.formData?.get("intent") === "save";
  const isUpgrading =
    isSubmitting && navigation.formData?.get("intent") === "upgrade";

  // Track if form is dirty
  const [isDirty, setIsDirty] = useState(false);

  // Position options
  const positionOptions = [
    { label: "Top", value: "top" },
    { label: "Bottom", value: "bottom" },
  ];

  // Handle action data response
  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        if (actionData.redirectUrl) {
          // Redirect to Shopify billing page
          window.open(actionData.redirectUrl, "_top");
        } else if (actionData.message) {
          shopify.toast.show(actionData.message);
          setIsDirty(false);
        }
      } else if (actionData.error) {
        shopify.toast.show(actionData.error, { isError: true });
      }
    }
  }, [actionData, shopify]);

  // Handle save
  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "save");
    formData.append("defaultPosition", defaultPosition);
    formData.append("defaultBgColor", defaultBgColor);
    formData.append("defaultTextColor", defaultTextColor);
    formData.append("showBranding", String(showBranding));
    submit(formData, { method: "post" });
  }, [
    defaultPosition,
    defaultBgColor,
    defaultTextColor,
    showBranding,
    submit,
  ]);

  // Handle upgrade
  const handleUpgrade = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "upgrade");
    submit(formData, { method: "post" });
  }, [submit]);

  // Handle export
  const handleExport = useCallback(async () => {
    setIsExporting(true);

    const formData = new FormData();
    formData.append("intent", "export");

    try {
      const response = await fetch("/app/settings", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.success && result.csv) {
        const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `announceflow_data_${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        shopify.toast.show("Data exported successfully");
      } else {
        shopify.toast.show(result.error || "Export failed", { isError: true });
      }
    } catch (error) {
      console.error("Export error:", error);
      shopify.toast.show("Export failed", { isError: true });
    } finally {
      setIsExporting(false);
    }
  }, [shopify]);

  // Handle delete all
  const handleDeleteAll = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "delete-all");
    submit(formData, { method: "post" });
    setDeleteModalOpen(false);
  }, [submit]);

  // Track form changes
  useEffect(() => {
    const hasChanges =
      defaultPosition !== (globalSettings.default_position || "top") ||
      defaultBgColor !== (globalSettings.default_bg_color || "#000000") ||
      defaultTextColor !== (globalSettings.default_text_color || "#FFFFFF") ||
      showBranding !== (globalSettings.show_branding !== false);
    setIsDirty(hasChanges);
  }, [defaultPosition, defaultBgColor, defaultTextColor, showBranding, globalSettings]);

  return (
    <Page
      backAction={{ content: "Dashboard", onAction: () => navigate("/app") }}
      title="Settings"
    >
      <TitleBar title="Settings">
        <button
          variant="primary"
          onClick={handleSave}
          disabled={isSaving || !isDirty}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </TitleBar>

      <BlockStack gap="500">
        {/* Plan Section */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                Your Plan
              </Text>
              {isPremium ? (
                <Badge tone="success">Premium Plan</Badge>
              ) : (
                <Badge>Free Plan</Badge>
              )}
            </InlineStack>

            <Divider />

            {isPremium ? (
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="span" variant="headingLg">
                    ${PLAN_PRICE}
                  </Text>
                  <Text as="span" variant="bodyMd" tone="subdued">
                    /month
                  </Text>
                </InlineStack>
                <BlockStack gap="200">
                  <Text as="span" variant="bodyMd">
                    Unlimited bars
                  </Text>
                  <Text as="span" variant="bodyMd">
                    No branding
                  </Text>
                </BlockStack>
                <Box paddingBlockStart="200">
                  <Link
                    url={`https://${shopDomain}/admin/settings/billing`}
                    target="_blank"
                    removeUnderline
                  >
                    <InlineStack gap="100" blockAlign="center">
                      <Text as="span" variant="bodyMd">
                        Manage Subscription
                      </Text>
                      <Icon source={ExternalIcon} />
                    </InlineStack>
                  </Link>
                </Box>
              </BlockStack>
            ) : (
              <BlockStack gap="300">
                <BlockStack gap="200">
                  <Text as="span" variant="bodyMd">
                    1 bar limit
                  </Text>
                  <Text as="span" variant="bodyMd">
                    Powered by AnnounceFlow branding
                  </Text>
                </BlockStack>

                <Divider />

                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    Upgrade to Premium for ${PLAN_PRICE}/month
                  </Text>
                  <BlockStack gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      - Unlimited announcement bars
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      - Email subscriber collection
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      - Remove AnnounceFlow branding
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      - Priority support
                    </Text>
                  </BlockStack>
                </BlockStack>

                <Button
                  variant="primary"
                  onClick={handleUpgrade}
                  loading={isUpgrading}
                >
                  Upgrade to Premium
                </Button>
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        {/* Global Settings Section */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Default Settings
            </Text>

            <Divider />

            <Select
              label="Default bar position"
              options={positionOptions}
              value={defaultPosition}
              onChange={(value) => {
                setDefaultPosition(value as BarPosition);
              }}
              helpText="These are used as defaults when creating new bars."
            />

            <InlineStack gap="400" align="start">
              <Box minWidth="200px">
                <ColorPicker
                  label="Default background color"
                  value={defaultBgColor}
                  onChange={setDefaultBgColor}
                />
              </Box>
              <Box minWidth="200px">
                <ColorPicker
                  label="Default text color"
                  value={defaultTextColor}
                  onChange={setDefaultTextColor}
                />
              </Box>
            </InlineStack>

          </BlockStack>
        </Card>

        {/* Branding Section (Premium only) */}
        {isPremium && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Branding
              </Text>

              <Divider />

              <Checkbox
                label='Show "Powered by AnnounceFlow" on bars'
                checked={showBranding}
                onChange={setShowBranding}
              />
              <Text as="p" variant="bodySm" tone="subdued">
                Keep this on to support AnnounceFlow!
              </Text>
            </BlockStack>
          </Card>
        )}

        {/* Data Section */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Your Data
            </Text>

            <Divider />

            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="span" variant="bodyMd">
                  Total bars created
                </Text>
                <Badge>{stats.totalBars}</Badge>
              </InlineStack>
              <InlineStack align="space-between">
                <Text as="span" variant="bodyMd">
                  Total email subscribers
                </Text>
                <Badge>{stats.totalSubscribers}</Badge>
              </InlineStack>
            </BlockStack>

            <Divider />

            <InlineStack gap="300">
              <Button
                icon={ExportIcon}
                onClick={handleExport}
                loading={isExporting}
                disabled={stats.totalSubscribers === 0}
              >
                Export All Data
              </Button>
              <Button
                icon={DeleteIcon}
                tone="critical"
                onClick={() => setDeleteModalOpen(true)}
                disabled={stats.totalSubscribers === 0}
              >
                Delete All Data
              </Button>
            </InlineStack>

            {stats.totalSubscribers === 0 && (
              <Text as="p" variant="bodySm" tone="subdued">
                No subscriber data to export or delete.
              </Text>
            )}
          </BlockStack>
        </Card>

        {/* Support Section */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Help & Support
            </Text>

            <Divider />

            <BlockStack gap="300">
              <Link
                url="/app/help"
                target="_blank"
                removeUnderline
              >
                <InlineStack gap="100" blockAlign="center">
                  <Text as="span" variant="bodyMd">
                    Documentation
                  </Text>
                  <Icon source={ExternalIcon} />
                </InlineStack>
              </Link>

              <Link
                url="mailto:support@codershive.com"
                removeUnderline
              >
                <InlineStack gap="100" blockAlign="center">
                  <Text as="span" variant="bodyMd">
                    Contact Support
                  </Text>
                  <Icon source={ExternalIcon} />
                </InlineStack>
              </Link>

              <Link
                url="https://github.com/anthropics/announceflow/issues"
                target="_blank"
                removeUnderline
              >
                <InlineStack gap="100" blockAlign="center">
                  <Text as="span" variant="bodyMd">
                    Report an Issue
                  </Text>
                  <Icon source={ExternalIcon} />
                </InlineStack>
              </Link>
            </BlockStack>
          </BlockStack>
        </Card>

        {/* Save Button Footer */}
        <Divider />
        <InlineStack align="end" gap="300">
          {isDirty && (
            <Text as="span" variant="bodySm" tone="subdued">
              You have unsaved changes
            </Text>
          )}
          <Button
            variant="primary"
            onClick={handleSave}
            loading={isSaving}
            disabled={!isDirty}
          >
            Save settings
          </Button>
        </InlineStack>
      </BlockStack>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete all subscriber data?"
        primaryAction={{
          content: "Delete all data",
          destructive: true,
          onAction: handleDeleteAll,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setDeleteModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              This will permanently delete all {stats.totalSubscribers} email
              subscriber{stats.totalSubscribers !== 1 ? "s" : ""} from your
              account.
            </Text>
            <Banner tone="critical">
              <p>This action cannot be undone.</p>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
