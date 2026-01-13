import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    const shopDomain = process.argv[2];
    if (!shopDomain) {
        console.error("Please provide a shop domain: npx tsx scripts/make-premium.ts your-shop.myshopify.com");
        process.exit(1);
    }

    await prisma.shop.update({
        where: { shopDomain },
        data: { plan: "PREMIUM" },
    });

    console.log(`Successfully updated ${shopDomain} to PREMIUM plan.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
