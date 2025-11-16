// ... existing code ...
const { PrismaClient, Prisma } = require("@prisma/client");
const { faker } = require("@faker-js/faker");

const prisma = new PrismaClient();

async function main() {
  // Clean existing data in safe order
  await prisma.transactionTag.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.budgetCategory.deleteMany({});
  await prisma.budget.deleteMany({});
  await prisma.recurringRule.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.category.deleteMany({});
  await prisma.tag.deleteMany({});
  await prisma.user.deleteMany({});

  // Seed config
  const USERS_COUNT = 3;
  const ACCOUNTS_PER_USER = 2;
  const TAGS_PER_USER = 6;
  const TRANSACTIONS_PER_USER = 160; // mix of income & expense
  const BUDGETS_PER_USER = 2;

  const expenseCategoryNames = [
    "Food",
    "Transport",
    "Bills",
    "Entertainment",
    "Shopping",
    "Health",
    "Rent",
    "Utilities",
  ];
  const incomeCategoryNames = ["Salary", "Business", "Investment", "Gift", "Freelance", "Other Income"];

  const users = [];
  for (let i = 0; i < USERS_COUNT; i++) {
    const email = faker.internet.email().toLowerCase();
    const name = faker.person.fullName();

    const user = await prisma.user.create({ data: { email, name } });
    users.push(user);

    // Accounts
    const accountTypes = ["cash", "bank", "wallet", "credit"];
    const accounts = [];
    for (let a = 0; a < ACCOUNTS_PER_USER; a++) {
      const acc = await prisma.account.create({
        data: {
          name: `${faker.company.name()} ${faker.helpers.arrayElement(["Main", "Savings", "Wallet"])}`,
          type: faker.helpers.arrayElement(accountTypes),
          currency: "INR",
          initialBalance: Number(faker.finance.amount({ min: 0, max: 5000, dec: 2 })),
          userId: user.id,
        },
      });
      accounts.push(acc);
    }

    // Categories (normalized)
    const categoriesExpense = [];
    for (const name of expenseCategoryNames) {
      const cat = await prisma.category.create({
        data: {
          name,
          type: "expense",
          color: faker.color.human(),
          userId: user.id,
        },
      });
      categoriesExpense.push(cat);
    }

    const categoriesIncome = [];
    for (const name of incomeCategoryNames) {
      const cat = await prisma.category.create({
        data: {
          name,
          type: "income",
          color: faker.color.human(),
          userId: user.id,
        },
      });
      categoriesIncome.push(cat);
    }

    // Tags
    const tags = [];
    const tagNames = new Set();
    while (tagNames.size < TAGS_PER_USER) {
      tagNames.add(faker.word.noun());
    }
    for (const tName of tagNames) {
      const tag = await prisma.tag.create({
        data: { name: tName, userId: user.id },
      });
      tags.push(tag);
    }

    // Budgets (current and previous month)
    const now = new Date();
    const months = [
      { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 },
      { year: now.getUTCFullYear(), month: Math.max(1, now.getUTCMonth()) }, // previous month
    ];
    for (let b = 0; b < Math.min(BUDGETS_PER_USER, months.length); b++) {
      const { year, month } = months[b];
      const budget = await prisma.budget.create({
        data: {
          name: `${faker.word.adjective()} ${faker.word.noun()} Budget`,
          year,
          month,
          limit: Number(faker.finance.amount({ min: 500, max: 5000, dec: 2 })),
          userId: user.id,
        },
      });

      // Link 3 random expense categories to budget
      const sampleCats = faker.helpers.arrayElements(categoriesExpense, 3);
      await prisma.budgetCategory.createMany({
        data: sampleCats.map((c) => ({ budgetId: budget.id, categoryId: c.id })),
        // REMOVED: skipDuplicates (not supported by your Prisma client)
      });
    }

    // Recurring rules (e.g., monthly salary and rent)
    await prisma.recurringRule.create({
      data: {
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 1,
        startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)),
        endDate: null,
      },
    });
    await prisma.recurringRule.create({
      data: {
        frequency: "monthly",
        interval: 1,
        dayOfMonth: 5,
        startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 5)),
        endDate: null,
      },
    });

    // Transactions
    const recentMonths = [0, -1, -2]; // current, -1, -2 months
    for (let t = 0; t < TRANSACTIONS_PER_USER; t++) {
      const type = faker.helpers.arrayElement(["income", "expense"]);
      const offset = faker.helpers.arrayElement(recentMonths);
      const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      const day = faker.number.int({ min: 1, max: 28 });
      const date = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), day));

      const isIncome = type === "income";
      const catRef = isIncome
        ? faker.helpers.arrayElement(categoriesIncome)
        : faker.helpers.arrayElement(categoriesExpense);

      const account = faker.helpers.arrayElement(accounts);
      const rawAmount = Number(
        faker.finance.amount({ min: isIncome ? 100 : 5, max: isIncome ? 3000 : 500, dec: 2 })
      );
      const amount = new Prisma.Decimal(rawAmount.toFixed(2));

      const created = await prisma.transaction.create({
        data: {
          type,
          date,
          category: catRef.name, // keep string category for compatibility
          description: isIncome
            ? faker.helpers.arrayElement(["Monthly Salary", "Bonus", "Business Income", "Investment Return"])
            : faker.commerce.productDescription(),
          amount,
          accountId: account.id,
          userId: user.id,
          categoryId: catRef.id,
          isDeleted: false,
        },
      });

      // Assign 0-2 tags
      const tagCount = faker.number.int({ min: 0, max: 2 });
      const chosenTags = faker.helpers.arrayElements(tags, tagCount);
      if (chosenTags.length) {
        await prisma.transactionTag.createMany({
          data: chosenTags.map((tg) => ({ transactionId: created.id, tagId: tg.id })),
          // REMOVED: skipDuplicates (not supported by your Prisma client)
        });
      }
    }
  }

  // Final summary logs
  const [userCount, txCount, catCount, tagCount, accCount, budgetCount] = await Promise.all([
    prisma.user.count(),
    prisma.transaction.count(),
    prisma.category.count(),
    prisma.tag.count(),
    prisma.account.count(),
    prisma.budget.count(),
  ]);
  console.log(
    `Seed complete. Users=${userCount}, Accounts=${accCount}, Categories=${catCount}, Tags=${tagCount}, Transactions=${txCount}, Budgets=${budgetCount}`
  );
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });