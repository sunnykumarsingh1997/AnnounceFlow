import type { Shop, EmailSubscriber } from "@prisma/client";
import prisma from "../db.server";

export { prisma };

// ============================================
// SHOP FUNCTIONS
// ============================================

/**
 * Get shop by domain
 */
export async function getShopByDomain(domain: string): Promise<Shop | null> {
  try {
    const shop = await prisma.shop.findUnique({
      where: {
        shopDomain: domain,
      },
    });
    return shop;
  } catch (error) {
    console.error(`Error fetching shop by domain (${domain}):`, error);
    throw new Error("Failed to fetch shop data");
  }
}

/**
 * Create a new shop
 */
export async function createShop(
  domain: string,
  accessToken: string
): Promise<Shop> {
  try {
    const shop = await prisma.shop.create({
      data: {
        shopDomain: domain,
        accessToken: accessToken,
        plan: "FREE",
        installedAt: new Date(),
      },
    });
    return shop;
  } catch (error) {
    console.error(`Error creating shop (${domain}):`, error);
    throw new Error("Failed to create shop");
  }
}

/**
 * Update shop plan
 */
export async function updateShopPlan(
  domain: string,
  plan: "FREE" | "PREMIUM"
): Promise<Shop> {
  try {
    const shop = await prisma.shop.update({
      where: {
        shopDomain: domain,
      },
      data: {
        plan: plan,
      },
    });
    return shop;
  } catch (error) {
    console.error(`Error updating shop plan (${domain}):`, error);
    throw new Error("Failed to update shop plan");
  }
}

/**
 * Mark shop as uninstalled (soft delete)
 */
export async function markShopUninstalled(domain: string): Promise<void> {
  try {
    await prisma.shop.update({
      where: {
        shopDomain: domain,
      },
      data: {
        uninstalledAt: new Date(),
      },
    });
  } catch (error) {
    console.error(`Error marking shop as uninstalled (${domain}):`, error);
    throw new Error("Failed to mark shop as uninstalled");
  }
}

/**
 * Delete all shop data (GDPR compliance - hard delete)
 */
export async function deleteShopData(domain: string): Promise<void> {
  try {
    // First get the shop to get its ID
    const shop = await prisma.shop.findUnique({
      where: {
        shopDomain: domain,
      },
    });

    if (!shop) {
      return;
    }

    // Delete all related data in a transaction
    await prisma.$transaction([
      // Delete all email subscribers for this shop
      prisma.emailSubscriber.deleteMany({
        where: {
          shopId: shop.id,
        },
      }),
      // Delete the shop
      prisma.shop.delete({
        where: {
          shopDomain: domain,
        },
      }),
    ]);

  } catch (error) {
    console.error(`Error deleting shop data (${domain}):`, error);
    throw new Error("Failed to delete shop data");
  }
}

// ============================================
// EMAIL SUBSCRIBER FUNCTIONS
// ============================================

/**
 * Create a new email subscriber (handles duplicates gracefully)
 */
export async function createSubscriber(
  shopId: string,
  email: string,
  barId: string,
  ipAddress?: string
): Promise<EmailSubscriber> {
  try {
    // Check if subscriber already exists
    const existing = await prisma.emailSubscriber.findFirst({
      where: {
        shopId: shopId,
        email: email,
      },
    });

    if (existing) {
      // Update existing subscriber
      const subscriber = await prisma.emailSubscriber.update({
        where: {
          id: existing.id,
        },
        data: {
          barId: barId,
          ipAddress: ipAddress,
          createdAt: new Date(), // Update capture time
        },
      });
      return subscriber;
    } else {
      // Create new subscriber
      const subscriber = await prisma.emailSubscriber.create({
        data: {
          shopId: shopId,
          email: email,
          barId: barId,
          ipAddress: ipAddress,
          createdAt: new Date(),
        },
      });
      return subscriber;
    }
  } catch (error) {
    console.error(`Error creating subscriber (${email}):`, error);
    throw new Error("Failed to create subscriber");
  }
}

/**
 * Get all subscribers for a shop
 */
export async function getSubscribersByShop(
  shopId: string
): Promise<EmailSubscriber[]> {
  try {
    const subscribers = await prisma.emailSubscriber.findMany({
      where: {
        shopId: shopId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    return subscribers;
  } catch (error) {
    console.error(`Error fetching subscribers for shop (${shopId}):`, error);
    throw new Error("Failed to fetch subscribers");
  }
}

/**
 * Get a specific subscriber by email
 */
export async function getSubscriberByEmail(
  shopId: string,
  email: string
): Promise<EmailSubscriber | null> {
  try {
    const subscriber = await prisma.emailSubscriber.findFirst({
      where: {
        shopId: shopId,
        email: email,
      },
    });
    return subscriber;
  } catch (error) {
    console.error(
      `Error fetching subscriber by email (${email}, shop: ${shopId}):`,
      error
    );
    throw new Error("Failed to fetch subscriber");
  }
}

/**
 * Check if a subscriber already exists
 */
export async function subscriberExists(
  shopId: string,
  email: string
): Promise<boolean> {
  try {
    const subscriber = await prisma.emailSubscriber.findFirst({
      where: {
        shopId: shopId,
        email: email,
      },
      select: { id: true },
    });
    return subscriber !== null;
  } catch (error) {
    console.error(`Error checking subscriber (${email}):`, error);
    return false;
  }
}

/**
 * Delete a subscriber by ID
 */
export async function deleteSubscriber(
  subscriberId: string,
  shopId: string
): Promise<boolean> {
  try {
    const result = await prisma.emailSubscriber.deleteMany({
      where: {
        id: subscriberId,
        shopId: shopId,
      },
    });
    return result.count > 0;
  } catch (error) {
    console.error(`Error deleting subscriber (${subscriberId}):`, error);
    throw new Error("Failed to delete subscriber");
  }
}

/**
 * Delete a subscriber by email
 */
export async function deleteSubscriberByEmail(
  shopId: string,
  email: string
): Promise<void> {
  try {
    await prisma.emailSubscriber.deleteMany({
      where: {
        shopId: shopId,
        email: email,
      },
    });
  } catch (error) {
    console.error(`Error deleting subscriber (${email}):`, error);
    throw new Error("Failed to delete subscriber");
  }
}

/**
 * Get subscriber statistics for a shop
 */
export async function getSubscriberStats(shopId: string): Promise<{
  total: number;
  thisWeek: number;
  thisMonth: number;
}> {
  try {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [total, thisWeek, thisMonth] = await Promise.all([
      prisma.emailSubscriber.count({ where: { shopId } }),
      prisma.emailSubscriber.count({
        where: { shopId, createdAt: { gte: startOfWeek } },
      }),
      prisma.emailSubscriber.count({
        where: { shopId, createdAt: { gte: startOfMonth } },
      }),
    ]);

    return { total, thisWeek, thisMonth };
  } catch (error) {
    console.error(`Error getting subscriber stats (shop: ${shopId}):`, error);
    return { total: 0, thisWeek: 0, thisMonth: 0 };
  }
}

/**
 * Get subscriber count for a shop
 */
export async function getSubscriberCount(shopId: string): Promise<number> {
  try {
    const count = await prisma.emailSubscriber.count({
      where: {
        shopId: shopId,
      },
    });
    return count;
  } catch (error) {
    console.error(`Error getting subscriber count (shop: ${shopId}):`, error);
    return 0;
  }
}

/**
 * Delete all subscribers for a shop
 */
export async function deleteAllSubscribers(shopId: string): Promise<void> {
  try {
    await prisma.emailSubscriber.deleteMany({
      where: {
        shopId: shopId,
      },
    });
  } catch (error) {
    console.error(`Error deleting all subscribers (shop: ${shopId}):`, error);
    throw new Error("Failed to delete subscribers");
  }
}

/**
 * Export subscribers as CSV string
 */
export async function exportSubscribersCSV(shopId: string): Promise<string> {
  try {
    const subscribers = await getSubscribersByShop(shopId);

    if (subscribers.length === 0) {
      return "email,bar_id,captured_at,ip_address\n";
    }

    // Create CSV header
    const header = "email,bar_id,captured_at,ip_address\n";

    // Create CSV rows
    const rows = subscribers.map((sub) => {
      const email = `"${sub.email.replace(/"/g, '""')}"`;
      const barId = `"${sub.barId.replace(/"/g, '""')}"`;
      const capturedAt = sub.createdAt.toISOString();
      const ipAddress = sub.ipAddress
        ? `"${sub.ipAddress.replace(/"/g, '""')}"`
        : "";

      return `${email},${barId},${capturedAt},${ipAddress}`;
    });

    const csv = header + rows.join("\n");
    return csv;
  } catch (error) {
    console.error(`Error exporting subscribers CSV (shop: ${shopId}):`, error);
    throw new Error("Failed to export subscribers");
  }
}