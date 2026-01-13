import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  useLoaderData,
  useNavigate,
  useSubmit,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import { useState, useCallback, useMemo } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  InlineStack,
  Badge,
  EmptyState,
  Banner,
  Box,
  IndexTable,
  useIndexResourceState,
  TextField,
  Pagination,
  Modal,
  Spinner,
  Icon,
  useBreakpoints,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { ExportIcon, SearchIcon } from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import {
  getShopByDomain,
  exportSubscribersCSV,
  prisma,
} from "../lib/db.server";
import { hasActivePremiumPlan } from "../lib/billing.server";

// Types
interface Subscriber {
  id: string;
  email: string;
  barId: string;
  createdAt: string;
  ipAddress: string | null;
}

interface LoaderData {
  subscribers: Subscriber[];
  stats: {
    total: number;
    thisWeek: number;
    thisMonth: number;
  };
  isPremium: boolean;
  shopId: string;
  pagination: {
    page: number;
    pageSize: number;
    totalPages: number;
    totalCount: number;
  };
  searchQuery: string;
}

// Loader function
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Check premium status
  const isPremium = await hasActivePremiumPlan(shopDomain);

  // Get shop from database
  const shop = await getShopByDomain(shopDomain);

  if (!shop) {
    return json<LoaderData>({
      subscribers: [],
      stats: { total: 0, thisWeek: 0, thisMonth: 0 },
      isPremium,
      shopId: "",
      pagination: { page: 1, pageSize: 25, totalPages: 0, totalCount: 0 },
      searchQuery: "",
    });
  }

  // Parse URL params
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const pageSize = 25;
  const searchQuery = url.searchParams.get("search") || "";

  // Build where clause for search
  const whereClause: any = { shopId: shop.id };
  if (searchQuery) {
    whereClause.email = {
      contains: searchQuery,
      mode: "insensitive",
    };
  }

  // Get total count for pagination
  const totalCount = await prisma.emailSubscriber.count({
    where: whereClause,
  });

  // Get paginated subscribers
  const subscribers = await prisma.emailSubscriber.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  // Calculate stats
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [thisWeekCount, thisMonthCount] = await Promise.all([
    prisma.emailSubscriber.count({
      where: {
        shopId: shop.id,
        createdAt: { gte: weekAgo },
      },
    }),
    prisma.emailSubscriber.count({
      where: {
        shopId: shop.id,
        createdAt: { gte: monthAgo },
      },
    }),
  ]);

  // Get total subscribers (without search filter for stats)
  const totalSubscribers = await prisma.emailSubscriber.count({
    where: { shopId: shop.id },
  });

  const totalPages = Math.ceil(totalCount / pageSize);

  return json<LoaderData>({
    subscribers: subscribers.map((sub) => ({
      id: sub.id,
      email: sub.email,
      barId: sub.barId,
      createdAt: sub.createdAt.toISOString(),
      ipAddress: sub.ipAddress,
    })),
    stats: {
      total: totalSubscribers,
      thisWeek: thisWeekCount,
      thisMonth: thisMonthCount,
    },
    isPremium,
    shopId: shop.id,
    pagination: {
      page,
      pageSize,
      totalPages,
      totalCount,
    },
    searchQuery,
  });
};

// Action function
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  // Get shop
  const shop = await getShopByDomain(shopDomain);
  if (!shop) {
    return json({ success: false, error: "Shop not found" }, { status: 404 });
  }

  if (intent === "delete") {
    const subscriberId = formData.get("subscriberId") as string;

    try {
      await prisma.emailSubscriber.delete({
        where: { id: subscriberId },
      });
      return json({ success: true, message: "Subscriber deleted" });
    } catch (error) {
      console.error("Error deleting subscriber:", error);
      return json(
        { success: false, error: "Failed to delete subscriber" },
        { status: 500 }
      );
    }
  }

  if (intent === "bulk-delete") {
    const subscriberIds = formData.get("subscriberIds") as string;
    const ids = JSON.parse(subscriberIds) as string[];

    try {
      await prisma.emailSubscriber.deleteMany({
        where: {
          id: { in: ids },
          shopId: shop.id,
        },
      });
      return json({
        success: true,
        message: `${ids.length} subscribers deleted`,
      });
    } catch (error) {
      console.error("Error bulk deleting subscribers:", error);
      return json(
        { success: false, error: "Failed to delete subscribers" },
        { status: 500 }
      );
    }
  }

  if (intent === "export") {
    try {
      const csv = await exportSubscribersCSV(shop.id);
      return json({ success: true, csv });
    } catch (error) {
      console.error("Error exporting subscribers:", error);
      return json(
        { success: false, error: "Failed to export subscribers" },
        { status: 500 }
      );
    }
  }

  return json({ success: false, error: "Unknown action" }, { status: 400 });
};

// Helper to format date
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Helper to get bar name from ID
function getBarDisplayName(barId: string): string {
  // Extract a readable name from the bar ID
  if (barId.startsWith("bar_")) {
    return `Bar ${barId.slice(4, 12)}...`;
  }
  return barId.length > 20 ? `${barId.slice(0, 20)}...` : barId;
}

export default function Subscribers() {
  const {
    subscribers,
    stats,
    isPremium,
    pagination,
    searchQuery: initialSearch,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const submit = useSubmit();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();
  const { smDown } = useBreakpoints();

  // State
  const [searchValue, setSearchValue] = useState(initialSearch);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [subscriberToDelete, setSubscriberToDelete] = useState<string | null>(
    null
  );
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Loading state
  const isLoading = navigation.state === "loading";
  const isSubmitting = navigation.state === "submitting";

  // Index table selection
  const resourceName = {
    singular: "subscriber",
    plural: "subscribers",
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange, clearSelection } =
    useIndexResourceState(subscribers);

  // Handle search
  const handleSearch = useCallback(
    (value: string) => {
      setSearchValue(value);
    },
    []
  );

  const handleSearchSubmit = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    if (searchValue) {
      params.set("search", searchValue);
    } else {
      params.delete("search");
    }
    params.set("page", "1");
    setSearchParams(params);
  }, [searchValue, searchParams, setSearchParams]);

  const handleSearchClear = useCallback(() => {
    setSearchValue("");
    const params = new URLSearchParams(searchParams);
    params.delete("search");
    params.set("page", "1");
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  // Handle pagination
  const handlePreviousPage = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(pagination.page - 1));
    setSearchParams(params);
  }, [pagination.page, searchParams, setSearchParams]);

  const handleNextPage = useCallback(() => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(pagination.page + 1));
    setSearchParams(params);
  }, [pagination.page, searchParams, setSearchParams]);

  // Handle single delete
  const handleDeleteClick = useCallback((subscriberId: string) => {
    setSubscriberToDelete(subscriberId);
    setDeleteModalOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!subscriberToDelete) return;

    const formData = new FormData();
    formData.append("intent", "delete");
    formData.append("subscriberId", subscriberToDelete);
    submit(formData, { method: "post" });

    setDeleteModalOpen(false);
    setSubscriberToDelete(null);
    shopify.toast.show("Subscriber deleted");
  }, [subscriberToDelete, submit, shopify]);

  // Handle bulk delete
  const handleBulkDeleteClick = useCallback(() => {
    if (selectedResources.length === 0) return;
    setBulkDeleteModalOpen(true);
  }, [selectedResources]);

  const handleBulkDeleteConfirm = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "bulk-delete");
    formData.append("subscriberIds", JSON.stringify(selectedResources));
    submit(formData, { method: "post" });

    setBulkDeleteModalOpen(false);
    clearSelection();
    shopify.toast.show(`${selectedResources.length} subscribers deleted`);
  }, [selectedResources, submit, shopify, clearSelection]);

  // Handle export
  const handleExport = useCallback(async () => {
    setIsExporting(true);

    const formData = new FormData();
    formData.append("intent", "export");

    try {
      const response = await fetch("/app/subscribers", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (result.success && result.csv) {
        // Create and download CSV file
        const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `subscribers_${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        shopify.toast.show("CSV exported successfully");
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

  // Promoted bulk actions
  const promotedBulkActions = useMemo(
    () => [
      {
        content: `Delete ${selectedResources.length} subscriber${selectedResources.length !== 1 ? "s" : ""}`,
        onAction: handleBulkDeleteClick,
        destructive: true,
      },
    ],
    [selectedResources.length, handleBulkDeleteClick]
  );

  // Row markup
  const rowMarkup = subscribers.map((subscriber, index) => (
    <IndexTable.Row
      id={subscriber.id}
      key={subscriber.id}
      selected={selectedResources.includes(subscriber.id)}
      position={index}
    >
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {subscriber.email}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge>{getBarDisplayName(subscriber.barId)}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{formatDate(subscriber.createdAt)}</IndexTable.Cell>
      <IndexTable.Cell>
        <Button
          variant="plain"
          tone="critical"
          onClick={() => handleDeleteClick(subscriber.id)}
          accessibilityLabel={`Delete ${subscriber.email}`}
        >
          Delete
        </Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  // Premium required view
  if (!isPremium) {
    return (
      <Page
        backAction={{ content: "Dashboard", onAction: () => navigate("/app") }}
        title="Email Subscribers"
      >
        <TitleBar title="Email Subscribers" />
        <Layout>
          <Layout.Section>
            <Banner tone="warning" title="Premium Feature">
              <p>
                Email subscriber collection is a premium feature. Upgrade your
                plan to collect and manage email subscribers from your
                announcement bars.
              </p>
            </Banner>
            <Box paddingBlockStart="500">
              <Card>
                <EmptyState
                  heading="Collect email subscribers"
                  action={{
                    content: "Upgrade to Premium",
                    onAction: () => navigate("/app/settings"),
                  }}
                  secondaryAction={{
                    content: "Create Email Bar",
                    onAction: () => navigate("/app/bars/new"),
                  }}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    Add email signup forms to your announcement bars and grow
                    your subscriber list. Export subscribers to your favorite
                    email marketing platform.
                  </p>
                </EmptyState>
              </Card>
            </Box>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Premium Features
                </Text>
                <BlockStack gap="200">
                  <InlineStack gap="200">
                    <Badge tone="success">Included</Badge>
                    <Text as="span" variant="bodyMd">
                      Email signup bars
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200">
                    <Badge tone="success">Included</Badge>
                    <Text as="span" variant="bodyMd">
                      Subscriber management
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200">
                    <Badge tone="success">Included</Badge>
                    <Text as="span" variant="bodyMd">
                      CSV export
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200">
                    <Badge tone="success">Included</Badge>
                    <Text as="span" variant="bodyMd">
                      Bulk operations
                    </Text>
                  </InlineStack>
                </BlockStack>
                <Box paddingBlockStart="200">
                  <Button variant="primary" onClick={() => navigate("/app/settings")}>
                    View Plans
                  </Button>
                </Box>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  // Empty state
  if (subscribers.length === 0 && !initialSearch) {
    return (
      <Page
        backAction={{ content: "Dashboard", onAction: () => navigate("/app") }}
        title="Email Subscribers"
      >
        <TitleBar title="Email Subscribers" />
        <BlockStack gap="500">
          {/* Stats Cards */}
          <Layout>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Total Subscribers
                  </Text>
                  <Text as="p" variant="headingLg">
                    {stats.total}
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    This Week
                  </Text>
                  <Text as="p" variant="headingLg">
                    {stats.thisWeek}
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    This Month
                  </Text>
                  <Text as="p" variant="headingLg">
                    {stats.thisMonth}
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          <Card>
            <EmptyState
              heading="No subscribers yet"
              action={{
                content: "Create Email Bar",
                onAction: () => navigate("/app/bars/new"),
              }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                No subscribers yet. Create an Email Capture bar to start
                collecting emails.
              </p>
            </EmptyState>
          </Card>
        </BlockStack>
      </Page>
    );
  }

  return (
    <Page
      backAction={{ content: "Dashboard", onAction: () => navigate("/app") }}
      title="Email Subscribers"
      primaryAction={{
        content: isExporting ? "Exporting..." : "Export CSV",
        icon: ExportIcon,
        onAction: handleExport,
        loading: isExporting,
        disabled: stats.total === 0,
      }}
    >
      <TitleBar title="Email Subscribers">
        <button onClick={handleExport} disabled={isExporting || stats.total === 0}>
          {isExporting ? "Exporting..." : "Export CSV"}
        </button>
      </TitleBar>

      <BlockStack gap="500">
        {/* Stats Cards */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" tone="subdued">
                  Total Subscribers
                </Text>
                <Text as="p" variant="headingLg">
                  {stats.total}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" tone="subdued">
                  This Week
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="p" variant="headingLg">
                    {stats.thisWeek}
                  </Text>
                  {stats.thisWeek > 0 && (
                    <Badge tone="success">{`+${stats.thisWeek}`}</Badge>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd" tone="subdued">
                  This Month
                </Text>
                <InlineStack gap="200" blockAlign="center">
                  <Text as="p" variant="headingLg">
                    {stats.thisMonth}
                  </Text>
                  {stats.thisMonth > 0 && (
                    <Badge tone="info">{`+${stats.thisMonth}`}</Badge>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Subscribers Table */}
        <Card padding="0">
          <BlockStack gap="0">
            {/* Search Bar */}
            <Box padding="400" borderBlockEndWidth="025" borderColor="border">
              <InlineStack gap="300" blockAlign="center">
                <div style={{ flexGrow: 1, maxWidth: "400px" }}>
                  <TextField
                    label="Search subscribers"
                    labelHidden
                    placeholder="Search by email..."
                    value={searchValue}
                    onChange={handleSearch}
                    onBlur={handleSearchSubmit}
                    autoComplete="off"
                    prefix={<Icon source={SearchIcon} />}
                    clearButton
                    onClearButtonClick={handleSearchClear}
                  />
                </div>
                <Button onClick={handleSearchSubmit}>Search</Button>
                {initialSearch && (
                  <Text as="span" variant="bodySm" tone="subdued">
                    Showing results for "{initialSearch}"
                  </Text>
                )}
              </InlineStack>
            </Box>

            {/* Loading Overlay */}
            {isLoading && (
              <Box padding="400">
                <InlineStack align="center">
                  <Spinner size="small" />
                  <Text as="span" variant="bodySm">
                    Loading...
                  </Text>
                </InlineStack>
              </Box>
            )}

            {/* No results state */}
            {!isLoading && subscribers.length === 0 && initialSearch && (
              <Box padding="600">
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="p" variant="bodyMd">
                    No subscribers found matching "{initialSearch}"
                  </Text>
                  <Button onClick={handleSearchClear}>Clear search</Button>
                </BlockStack>
              </Box>
            )}

            {/* Table */}
            {!isLoading && subscribers.length > 0 && (
              <>
                <IndexTable
                  resourceName={resourceName}
                  itemCount={subscribers.length}
                  selectedItemsCount={
                    allResourcesSelected ? "All" : selectedResources.length
                  }
                  onSelectionChange={handleSelectionChange}
                  headings={[
                    { title: "Email" },
                    { title: "Source Bar" },
                    { title: "Subscribed Date" },
                    { title: "Actions" },
                  ]}
                  promotedBulkActions={promotedBulkActions}
                  loading={isSubmitting}
                  condensed={smDown}
                >
                  {rowMarkup}
                </IndexTable>

                {/* Pagination */}
                {pagination.totalPages > 1 && (
                  <Box
                    padding="400"
                    borderBlockStartWidth="025"
                    borderColor="border"
                  >
                    <InlineStack align="center" gap="400">
                      <Pagination
                        hasPrevious={pagination.page > 1}
                        onPrevious={handlePreviousPage}
                        hasNext={pagination.page < pagination.totalPages}
                        onNext={handleNextPage}
                      />
                      <Text as="span" variant="bodySm" tone="subdued">
                        Page {pagination.page} of {pagination.totalPages} (
                        {pagination.totalCount} total)
                      </Text>
                    </InlineStack>
                  </Box>
                )}
              </>
            )}
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Single Delete Confirmation Modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete subscriber?"
        primaryAction={{
          content: "Delete",
          destructive: true,
          onAction: handleDeleteConfirm,
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
          <Text as="p">
            Are you sure you want to delete this subscriber? This action cannot
            be undone.
          </Text>
        </Modal.Section>
      </Modal>

      {/* Bulk Delete Confirmation Modal */}
      <Modal
        open={bulkDeleteModalOpen}
        onClose={() => setBulkDeleteModalOpen(false)}
        title={`Delete ${selectedResources.length} subscribers?`}
        primaryAction={{
          content: `Delete ${selectedResources.length} subscribers`,
          destructive: true,
          onAction: handleBulkDeleteConfirm,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setBulkDeleteModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to delete {selectedResources.length}{" "}
            subscriber{selectedResources.length !== 1 ? "s" : ""}? This action
            cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
