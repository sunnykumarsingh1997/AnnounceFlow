import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate, useSearchParams, useRevalidator, useFetcher, useNavigation } from "@remix-run/react";
import { useEffect, useState, useCallback } from "react";
import {
  Page,
  SkeletonPage,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  EmptyState,
  InlineStack,
  Badge,
  Box,
  IndexTable,
  Banner,
  Modal,
  SkeletonBodyText,
  SkeletonDisplayText,
  Icon,
  InlineGrid,
  Tooltip,
  Spinner,
  useBreakpoints,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import {
  PlusIcon,
  DeleteIcon,
  EditIcon,
  ClockIcon,
  MegaphoneIcon,
  DeliveryIcon,
  EmailIcon,
  LockIcon,
  QuestionCircleIcon,
  TargetIcon,
  CheckCircleIcon,
  XCircleIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import { getBarsConfig, deleteBar, toggleBarEnabled } from "../lib/metafields.server";
import { getShopByDomain } from "../lib/db.server";
import type { Bar } from "../lib/types";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const config = await getBarsConfig(admin);

    // Get actual plan from database
    const shop = await getShopByDomain(session.shop);
    const isPremium = shop?.plan === "PREMIUM";

    return json({
      bars: config.bars,
      globalSettings: config.global_settings,
      plan: {
        name: isPremium ? "Premium" : "Free",
        barLimit: isPremium ? 999 : 1,
        isPremium: isPremium,
      },
      error: null,
    });
  } catch (error) {
    return json({
      bars: [],
      globalSettings: {},
      plan: { name: "Free", barLimit: 1, isPremium: false },
      error: "Failed to load announcement bars. Please try again.",
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle") {
    const barId = formData.get("barId") as string;
    const result = await toggleBarEnabled(admin, barId, session.shop);
    if (!result.success) {
      return json({ success: false, error: result.errors?.join(", ") }, { status: 500 });
    }
    const response: any = { success: true, enabled: result.enabled };
    if (result.autoDisabled && result.autoDisabled.length > 0) {
      response.auto_disabled = result.autoDisabled;
    }
    return json(response);
  }

  if (intent === "delete") {
    const barId = formData.get("barId") as string;
    const result = await deleteBar(admin, barId);
    if (!result.success) {
      return json({ success: false, error: result.errors?.join(", ") }, { status: 500 });
    }
    return json({ success: true, deleted: true });
  }

  return json({ success: false, error: "Invalid intent" }, { status: 400 });
};

// Feature card data for empty state
const featureCards = [
  {
    icon: MegaphoneIcon,
    title: "Promotional Announcements",
    description: "Share sales, discounts, and updates with your customers",
  },
  {
    icon: ClockIcon,
    title: "Countdown Timers",
    description: "Create urgency for flash sales and limited-time offers",
  },
  {
    icon: DeliveryIcon,
    title: "Free Shipping Progress",
    description: "Increase average order value with shipping thresholds",
  },
  {
    icon: EmailIcon,
    title: "Email Capture",
    description: "Grow your mailing list with signup forms",
  },
  {
    icon: LockIcon,
    title: "Cookie Consent",
    description: "GDPR compliance made easy for your store",
  },
  {
    icon: TargetIcon,
    title: "Targeted Messaging",
    description: "Show relevant messages to specific customer segments",
  },
];

// Helper: Format relative date
const formatRelativeDate = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) !== 1 ? "s" : ""} ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

// Helper: Get bar type icon
const getTypeIcon = (type: string) => {
  switch (type) {
    case "countdown":
      return ClockIcon;
    case "promotional":
      return MegaphoneIcon;
    case "announcement":
      return MegaphoneIcon;
    case "email_signup":
      return EmailIcon;
    case "free_shipping":
      return DeliveryIcon;
    case "cookie_consent":
      return LockIcon;
    default:
      return QuestionCircleIcon;
  }
};

// Helper: Get bar type badge
const getTypeBadge = (type: string) => {
  switch (type) {
    case "countdown":
      return <Badge tone="attention">Countdown</Badge>;
    case "promotional":
      return <Badge tone="info">Promotional</Badge>;
    case "announcement":
      return <Badge>Announcement</Badge>;
    case "email_signup":
      return <Badge tone="magic">Email Signup</Badge>;
    case "free_shipping":
      return <Badge tone="success">Free Shipping</Badge>;
    case "cookie_consent":
      return <Badge tone="warning">Cookie Consent</Badge>;
    default:
      return <Badge>{type}</Badge>;
  }
};

export default function Dashboard() {
  const { bars, plan, error: loaderError } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const [searchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const fetcher = useFetcher<typeof action>();
  const navigation = useNavigation();
  const { smDown } = useBreakpoints();

  // State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [barToDelete, setBarToDelete] = useState<Bar | null>(null);
  const isDeleting = fetcher.state === "submitting" && fetcher.formData?.get("intent") === "delete";
  const [togglingBars, setTogglingBars] = useState<Set<string>>(new Set());
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);

  // Track loading state during revalidation
  const isLoading = navigation.state === "loading" || revalidator.state === "loading" || retryLoading;

  // Handle nullable bars - filter out nulls
  const validBars = (bars || []).filter((bar): bar is Bar => bar !== null);

  // Plan logic
  const isFreePlan = !plan.isPremium;
  const hasReachedBarLimit = isFreePlan && validBars.length >= plan.barLimit;

  // Show toast messages based on URL params
  useEffect(() => {
    const created = searchParams.get("created");
    const updated = searchParams.get("updated");
    const deleted = searchParams.get("deleted");
    const error = searchParams.get("error");
    const billing = searchParams.get("billing");

    if (created === "true") {
      shopify.toast.show("Announcement bar created successfully");
    } else if (updated === "true") {
      shopify.toast.show("Announcement bar updated successfully");
    } else if (deleted === "true") {
      shopify.toast.show("Announcement bar deleted");
    } else if (error === "not_found") {
      shopify.toast.show("Bar not found", { isError: true });
    } else if (billing === "success") {
      shopify.toast.show("Successfully upgraded to Premium! 🎉");
      // Revalidate to refresh plan data
      revalidator.revalidate();
    } else if (billing === "cancelled") {
      shopify.toast.show("Upgrade was cancelled", { isError: false });
    } else if (billing === "failed") {
      shopify.toast.show("Upgrade failed. Please try again.", { isError: true });
    } else if (billing === "error") {
      shopify.toast.show("An error occurred during upgrade. Please contact support.", { isError: true });
    }

    // Clear search params after showing toast
    if (created || updated || deleted || error || billing) {
      window.history.replaceState({}, "", "/app");
    }
  }, [searchParams, shopify, revalidator]);

  // Handle fetcher toast messages
  useEffect(() => {
    const data = fetcher.data as any; // Type assertion to handle discriminated union
    if (data && !data.success && data.error) {
      shopify.toast.show(data.error, { isError: true });
    } else if (data?.success && data.deleted) {
      shopify.toast.show("Announcement bar deleted");
      setDeleteModalOpen(false);
      setBarToDelete(null);
    } else if (data?.success && data.enabled !== undefined) {
      shopify.toast.show(data.enabled ? "Bar enabled" : "Bar disabled");
    }
  }, [fetcher.data, shopify]);

  // Calculate stats
  const activeBars = validBars.filter((bar) => bar.enabled).length;
  const totalViews = validBars.reduce((sum, bar) => sum + (bar.analytics?.views || 0), 0);
  const totalClicks = validBars.reduce((sum, bar) => sum + (bar.analytics?.clicks || 0), 0);
  const clickRate = totalViews > 0 ? ((totalClicks / totalViews) * 100).toFixed(1) : "0";

  // Handle toggle bar enabled (optimistic update with fetcher)
  const handleToggle = useCallback((bar: Bar) => {
    setTogglingBars((prev) => new Set(prev).add(bar.id));

    // We can rely on automatic revalidation or optimistic UI, 
    // but here we just submit and wait for reloader.
    // Ideally we would optimistically update the state, but Remix loaders will re-run automatically.

    fetcher.submit(
      { intent: "toggle", barId: bar.id },
      { method: "post" }
    );

    // Remove from toggling set after a short delay (or when revalidation completes)
    // For now we just assume it's quick
    setTimeout(() => {
      setTogglingBars((prev) => {
        const newSet = new Set(prev);
        newSet.delete(bar.id);
        return newSet;
      });
    }, 500);

  }, [fetcher]);

  // Handle delete
  const handleDeleteClick = useCallback((bar: Bar) => {
    setBarToDelete(bar);
    setDeleteModalOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!barToDelete) return;
    fetcher.submit(
      { intent: "delete", barId: barToDelete.id },
      { method: "post" }
    );
  }, [barToDelete, fetcher]);

  // Handle create bar click
  const handleCreateBar = useCallback(() => {
    if (hasReachedBarLimit) {
      setUpgradeModalOpen(true);
    } else {
      navigate("/app/bars/new");
    }
  }, [hasReachedBarLimit, navigate]);

  // Handle retry on error
  const handleRetry = useCallback(async () => {
    setRetryLoading(true);
    revalidator.revalidate();
    // Wait a bit for the revalidation to complete
    setTimeout(() => setRetryLoading(false), 1000);
  }, [revalidator]);

  // Check if countdown is expired
  const isCountdownExpired = (bar: Bar) => {
    if (bar.type !== "countdown" || !bar.content.end_datetime) return false;
    return new Date(bar.content.end_datetime).getTime() <= Date.now();
  };

  const resourceName = {
    singular: "bar",
    plural: "bars",
  };

  // Row markup for IndexTable
  const rowMarkup = validBars.map((bar, index) => {
    const isToggling = togglingBars.has(bar.id);
    const expired = bar.type === "countdown" && isCountdownExpired(bar);

    return (
      <IndexTable.Row
        id={bar.id}
        key={bar.id}
        position={index}
        onClick={() => navigate(`/app/bars/${bar.id}`)}
      >
        {/* Status Column - Toggle */}
        <IndexTable.Cell>
          <div onClick={(e) => e.stopPropagation()}>
            {isToggling ? (
              <Spinner size="small" />
            ) : (
              <Tooltip content={bar.enabled ? "Click to disable" : "Click to enable"}>
                <Button
                  variant="plain"
                  onClick={() => handleToggle(bar)}
                  disabled={expired && !bar.enabled}
                  accessibilityLabel={bar.enabled ? "Disable bar" : "Enable bar"}
                  icon={bar.enabled ? CheckCircleIcon : XCircleIcon}
                  tone={bar.enabled ? undefined : "critical"}
                />
              </Tooltip>
            )}
          </div>
        </IndexTable.Cell>

        {/* Name Column */}
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {bar.name}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {bar.content.text.length > 50
                ? bar.content.text.substring(0, 50) + "..."
                : bar.content.text}
            </Text>
          </BlockStack>
        </IndexTable.Cell>

        {/* Type Column */}
        <IndexTable.Cell>
          <InlineStack gap="200" blockAlign="center">
            <Icon source={getTypeIcon(bar.type)} tone="base" />
            {getTypeBadge(bar.type)}
            {expired && <Badge tone="warning">Expired</Badge>}
          </InlineStack>
        </IndexTable.Cell>

        {/* Created/Last Edited Column */}
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodySm" tone="subdued">
              Created: {formatRelativeDate(bar.created_at)}
            </Text>
            {bar.updated_at && bar.updated_at !== bar.created_at && (
              <Text as="span" variant="bodySm" tone="subdued">
                Edited: {formatRelativeDate(bar.updated_at)}
              </Text>
            )}
          </BlockStack>
        </IndexTable.Cell>

        {/* Actions Column */}
        <IndexTable.Cell>
          <div onClick={(e) => e.stopPropagation()}>
            <InlineStack gap="200">
              <Tooltip content="Edit bar">
                <Button
                  size="slim"
                  icon={EditIcon}
                  onClick={() => navigate(`/app/bars/${bar.id}`)}
                  accessibilityLabel={`Edit ${bar.name}`}
                />
              </Tooltip>
              <Tooltip content="Delete bar">
                <Button
                  size="slim"
                  icon={DeleteIcon}
                  tone="critical"
                  onClick={() => handleDeleteClick(bar)}
                  accessibilityLabel={`Delete ${bar.name}`}
                />
              </Tooltip>
            </InlineStack>
          </div>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  // Empty State Component
  const EmptyStateContent = () => (
    <BlockStack gap="800">
      <Card>
        <EmptyState
          heading="Create your first announcement bar"
          action={{
            content: "Create Bar",
            icon: PlusIcon,
            onAction: () => navigate("/app/bars/new"),
          }}
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <p>
            Announcement bars help you communicate important messages to your customers.
            Share sales, create urgency with countdowns, or grow your email list.
          </p>
        </EmptyState>
      </Card>

      <BlockStack gap="400">
        <Text as="h2" variant="headingMd">
          What you can create
        </Text>
        <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
          {featureCards.map((feature, index) => (
            <Card key={index}>
              <BlockStack gap="300">
                <InlineStack gap="300" blockAlign="center">
                  <Box padding="200" borderRadius="200" background="bg-surface-secondary">
                    <Icon source={feature.icon} tone="base" />
                  </Box>
                  <Text as="h3" variant="headingSm" fontWeight="semibold">
                    {feature.title}
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {feature.description}
                </Text>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>
      </BlockStack>

    </BlockStack>
  );

  // Error State
  if (loaderError && validBars.length === 0) {
    return (
      <Page title="Dashboard">
        <TitleBar title="Dashboard" />
        <Card>
          <BlockStack gap="400">
            <Banner
              title="Failed to load announcement bars"
              tone="critical"
              action={{ content: "Retry", onAction: handleRetry, loading: retryLoading }}
            >
              <p>{loaderError}</p>
            </Banner>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  // Loading State
  if (isLoading && validBars.length === 0) {
    return (
      <SkeletonPage primaryAction title="Dashboard">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={3} />
                <SkeletonBodyText lines={3} />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </SkeletonPage>
    );
  }

  // Empty State
  if (validBars.length === 0) {
    return (
      <Page title="Dashboard">
        <TitleBar title="Dashboard" />
        <EmptyStateContent />
      </Page>
    );
  }

  // Dashboard with bars
  return (
    <Page title="Dashboard">
      <TitleBar title="Dashboard">
        <button variant="primary" onClick={handleCreateBar}>
          Create Bar
        </button>
      </TitleBar>

      <BlockStack gap="500">
        {/* Free Plan Banner */}
        {isFreePlan && (
          <Banner
            title="You're on the Free plan"
            tone="info"
            action={{
              content: "Upgrade to Premium",
              onAction: () => setUpgradeModalOpen(true),
            }}
          >
            <p>
              Free plan includes {plan.barLimit} bar{plan.barLimit !== 1 ? "s" : ""}.
              Upgrade to Premium for unlimited bars, advanced targeting, and analytics.
            </p>
          </Banner>
        )}

        {/* Bar limit warning */}
        {hasReachedBarLimit && (
          <Banner
            title="Bar limit reached"
            tone="warning"
            action={{
              content: "Upgrade Now",
              onAction: () => setUpgradeModalOpen(true),
            }}
          >
            <p>
              You've reached your Free plan limit of {plan.barLimit} bar{plan.barLimit !== 1 ? "s" : ""}.
              Upgrade to create more announcement bars.
            </p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            {/* Bar List */}
            <Card padding="0">
              <BlockStack>
                <Box padding="400" paddingBlockEnd="0">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Your Announcement Bars ({validBars.length})
                    </Text>
                    <Button
                      icon={PlusIcon}
                      onClick={handleCreateBar}
                      disabled={hasReachedBarLimit}
                    >
                      Create bar
                    </Button>
                  </InlineStack>
                </Box>
                <IndexTable
                  resourceName={resourceName}
                  itemCount={validBars.length}
                  loading={isLoading}
                  condensed={smDown}
                  headings={[
                    { title: "Status", alignment: "center" },
                    { title: "Name" },
                    { title: "Type" },
                    { title: "Last edited" },
                    { title: "Actions" },
                  ]}
                  selectable={false}
                >
                  {rowMarkup}
                </IndexTable>
              </BlockStack>
            </Card>

            {/* Active bars info */}
            {activeBars > 0 && (
              <Box paddingBlockStart="400">
                <Banner tone="success">
                  <p>
                    <strong>{activeBars} bar{activeBars !== 1 ? "s" : ""}</strong> currently active.
                    Make sure you've added the AnnounceFlow block to your theme.
                  </p>
                </Banner>
              </Box>
            )}
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              {/* Quick Stats */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Quick Stats</Text>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">Total Bars</Text>
                      <Badge>{validBars.length.toString()}</Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">Active Bars</Text>
                      <Badge tone="success">{activeBars.toString()}</Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">Total Views</Text>
                      <Text as="span" variant="bodyMd">{totalViews.toLocaleString()}</Text>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">Click Rate</Text>
                      <Text as="span" variant="bodyMd">{clickRate}%</Text>
                    </InlineStack>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Current Plan */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Current Plan</Text>
                    <Badge tone={plan.isPremium ? "success" : undefined}>
                      {plan.name}
                    </Badge>
                  </InlineStack>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">Bar Limit</Text>
                      <Text as="span" variant="bodyMd">
                        {plan.isPremium ? "Unlimited" : `${validBars.length}/${plan.barLimit}`}
                      </Text>
                    </InlineStack>
                    {!plan.isPremium && (
                      <Box paddingBlockStart="200">
                        <Button
                          fullWidth
                          variant="primary"
                          onClick={() => setUpgradeModalOpen(true)}
                        >
                          Upgrade to Premium
                        </Button>
                      </Box>
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Quick Create */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Quick Create</Text>
                  <BlockStack gap="200">
                    <Button
                      fullWidth
                      onClick={() => hasReachedBarLimit ? setUpgradeModalOpen(true) : navigate("/app/bars/new")}
                      textAlign="start"
                      disabled={hasReachedBarLimit}
                    >
                      Promotional Bar
                    </Button>
                    <Button
                      fullWidth
                      onClick={() => hasReachedBarLimit ? setUpgradeModalOpen(true) : navigate("/app/bars/new?type=countdown")}
                      textAlign="start"
                      icon={ClockIcon}
                      disabled={hasReachedBarLimit}
                    >
                      Countdown Timer
                    </Button>
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* Delete Confirmation Modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setBarToDelete(null);
        }}
        title="Delete bar?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDeleteConfirm,
          loading: isDeleting,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setDeleteModalOpen(false);
              setBarToDelete(null);
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p">
              Are you sure you want to delete "<strong>{barToDelete?.name}</strong>"?
            </Text>
            <Text as="p" tone="subdued">
              This action cannot be undone. All analytics data for this bar will also be deleted.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      {/* Upgrade Modal */}
      <Modal
        open={upgradeModalOpen}
        onClose={() => setUpgradeModalOpen(false)}
        title="Upgrade to Premium"
        primaryAction={{
          content: isUpgrading ? "Processing..." : "Start Free Trial",
          loading: isUpgrading,
          onAction: async () => {
            setIsUpgrading(true);
            try {
              const response = await fetch("/api/billing/subscribe", {
                method: "POST",
              });
              const data = await response.json();

              if (data.success && data.confirmationUrl) {
                // Redirect to Shopify billing confirmation page
                window.top!.location.href = data.confirmationUrl;
              } else {
                shopify.toast.show(data.error || "Failed to start subscription", { isError: true });
                setUpgradeModalOpen(false);
              }
            } catch (error) {
              console.error("Billing error:", error);
              shopify.toast.show("Failed to connect to billing service", { isError: true });
              setUpgradeModalOpen(false);
            } finally {
              setIsUpgrading(false);
            }
          },
          disabled: isUpgrading,
        }}
        secondaryActions={[
          {
            content: "Maybe Later",
            onAction: () => setUpgradeModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" variant="bodyMd">
              Unlock the full power of AnnounceFlow with Premium:
            </Text>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <Icon source={CheckCircleIcon} tone="success" />
                <Text as="span" variant="bodyMd">Unlimited announcement bars</Text>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center">
                <Icon source={CheckCircleIcon} tone="success" />
                <Text as="span" variant="bodyMd">Advanced targeting rules</Text>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center">
                <Icon source={CheckCircleIcon} tone="success" />
                <Text as="span" variant="bodyMd">Detailed analytics & reports</Text>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center">
                <Icon source={CheckCircleIcon} tone="success" />
                <Text as="span" variant="bodyMd">Email capture & integrations</Text>
              </InlineStack>
              <InlineStack gap="200" blockAlign="center">
                <Icon source={CheckCircleIcon} tone="success" />
                <Text as="span" variant="bodyMd">Priority support</Text>
              </InlineStack>
            </BlockStack>
            <Box paddingBlockStart="200">
              <Text as="p" variant="headingLg" fontWeight="bold">
                $99.00/month
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                7-day free trial included
              </Text>
            </Box>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
