// ... existing code ...
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const data = [
    { type: "income", date: new Date("2025-10-01"), category: "Salary", description: "October Salary", amount: 2500 },
    { type: "expense", date: new Date("2025-10-02"), category: "Food", description: "Groceries", amount: 42.75 },
    { type: "expense", date: new Date("2025-10-05"), category: "Transport", description: "Bus pass", amount: 15.0 },
    { type: "expense", date: new Date("2025-10-12"), category: "Bills", description: "Electricity bill", amount: 68.2 },
    { type: "income", date: new Date("2025-11-01"), category: "Business", description: "Side project", amount: 400 },
    { type: "expense", date: new Date("2025-11-01"), category: "Entertainment", description: "Movie night", amount: 12.0 },
    { type: "expense", date: new Date("2025-11-03"), category: "Food", description: "Lunch out", amount: 9.5 },
    { type: "expense", date: new Date("2025-11-10"), category: "Shopping", description: "Clothes", amount: 55.99 },
  ];

  for (const t of data) {
    await prisma.transaction.create({ data: t });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
// ... existing code ...