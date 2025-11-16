// ... existing code ...
require("dotenv").config();
const express = require("express");
const cors = require("cors");
// CHANGED: import Prisma helper for Decimal
const { PrismaClient, Prisma } = require("@prisma/client");
// NEW: Clerk imports
const { clerkMiddleware, requireAuth, getAuth } = require("@clerk/express");
const { clerkClient } = require("@clerk/express");

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());
// NEW: enable Clerk on all requests (adds auth context)
app.use(clerkMiddleware());

// NEW: ensure there is a local Prisma user for the authenticated Clerk user
async function ensureLocalUser(req, res, next) {
  const auth = getAuth(req);
  if (!auth?.userId) return next();
  const clerkId = auth.userId;

  let user = await prisma.user.findUnique({ where: { clerkId } });
  if (!user) {
    try {
      const cu = await clerkClient.users.getUser(clerkId);
      const email = cu.emailAddresses?.[0]?.emailAddress ?? null;
      const name = [cu.firstName, cu.lastName].filter(Boolean).join(" ") || null;
      user = await prisma.user.create({
        data: {
          clerkId,
          email: email || `user_${clerkId}@example.local`,
          name,
        },
      });
    } catch (_err) {
      user = await prisma.user.create({ data: { clerkId } });
    }
  }
  req.userDb = user;
  next();
}

// Health remains public
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// NEW: protect all /api routes and attach local user
app.use("/api", requireAuth());
app.use("/api", ensureLocalUser);

app.use(express.urlencoded())
app.use(express.json())

// NEW: helper to normalize Decimal inputs
const toDecimal = (val) => new Prisma.Decimal(typeof val === "string" ? val : Number(val).toFixed(2));

// Helper: build date range from YYYY-MM (month)
function monthRange(yyyyMm) {
  // Expect format "YYYY-MM"
  const [yearStr, monthStr] = (yyyyMm || "").split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!year || !month || month < 1 || month > 12) return null;

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1)); // next month
  return { start, end };
}

// EDIT: transactions list — exclude soft-deleted, support more filters, include tags
app.get("/api/transactions", async (req, res) => {
  try {
    const { type, category, month, accountId, userId, categoryId } = req.query;
    const where = { isDeleted: false };

    if (type === "income" || type === "expense") where.type = type;
    if (category) where.category = String(category);
    if (accountId) where.accountId = Number(accountId);
    if (categoryId) where.categoryId = Number(categoryId);
    // NEW: prefer explicit userId, else use authenticated local user
    if (userId) where.userId = Number(userId);
    else if (req.userDb?.id) where.userId = req.userDb.id;

    const range = monthRange(month); // assume existing helper
    if (range) where.date = { gte: range.start, lt: range.end };

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      include: { tags: { include: { tag: true } }, account: true, categoryRef: true },
    });

    res.json(transactions);
  } catch (err) {
    console.error("GET /api/transactions error:", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// EDIT: create transaction — use Decimal and support optional relations
// ... existing code ...

app.post("/api/transactions", async (req, res) => {
  try {
    const { type, date, category, description, amount, accountId, userId, categoryId } = req.body;

    if (type !== "income" && type !== "expense") return res.status(400).json({ error: "Invalid type" });
    if (!date || (!category && !categoryId)) return res.status(400).json({ error: "Missing required fields" });

    const amountNum = Number(amount);
    if (Number.isNaN(amountNum)) return res.status(400).json({ error: "Invalid amount" });

    // NEW: resolve user, account, and category defaults
    const effectiveUserId = userId ? Number(userId) : (req.userDb?.id ?? null);
    if (!effectiveUserId) return res.status(401).json({ error: "Unauthorized" });

    // NEW: pick first account for the user, or create a default "Cash" account
    const resolvedAccountId = accountId
      ? Number(accountId)
      : await (async () => {
          const firstAcc = await prisma.account.findFirst({
            where: { userId: effectiveUserId },
            orderBy: { id: "asc" },
          });
          if (firstAcc) return firstAcc.id;
          const createdAcc = await prisma.account.create({
            data: {
              name: "Cash",
              type: "cash",
              currency: "INR",
              initialBalance: new Prisma.Decimal(0),
              userId: effectiveUserId,
            },
          });
          return createdAcc.id;
        })();

    // NEW: resolve categoryId from name+type, auto-create if missing
    const resolvedCategoryId = categoryId
      ? Number(categoryId)
      : await (async () => {
          if (!category) return null;
          let cat = await prisma.category.findFirst({
            where: { userId: effectiveUserId, name: String(category), type },
          });
          if (!cat) {
            cat = await prisma.category.create({
              data: { name: String(category), type, color: "#999999", userId: effectiveUserId },
            });
          }
          return cat.id;
        })();

    const created = await prisma.transaction.create({
      data: {
        type,
        date: new Date(date),
        category: category ?? null,
        description: description ?? null,
        amount: toDecimal(amountNum), // NEW Decimal
        isDeleted: false,
        accountId: resolvedAccountId,
        // NEW: use current authenticated user if not explicitly provided
        userId: effectiveUserId,
        categoryId: resolvedCategoryId,
      },
    });

    res.status(201).json(created);
  } catch (err) {
    console.error("POST /api/transactions error:", err);
    // NEW: expose Prisma error message to help debugging
    const detail = err?.message || "Failed to create transaction";
    res.status(500).json({ error: detail });
  }
});

// ... existing code ...

// Fix listen port mismatch


// ... existing code ...

// EDIT: update transaction — handle Decimal and relations
app.put("/api/transactions/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const { type, date, category, description, amount, accountId, userId, categoryId, isDeleted } = req.body;

    const data = {};
    if (type === "income" || type === "expense") data.type = type;
    if (date) data.date = new Date(date);
    if (typeof category !== "undefined") data.category = category ?? null;
    if (typeof description !== "undefined") data.description = description ?? null;
    if (typeof amount !== "undefined") {
      const amountNum = Number(amount);
      if (Number.isNaN(amountNum)) return res.status(400).json({ error: "Invalid amount" });
      data.amount = toDecimal(amountNum); // NEW Decimal
    }
    if (typeof accountId !== "undefined") data.accountId = accountId ? Number(accountId) : null;
    if (typeof userId !== "undefined") data.userId = userId ? Number(userId) : null;
    if (typeof categoryId !== "undefined") data.categoryId = categoryId ? Number(categoryId) : null;
    if (typeof isDeleted !== "undefined") data.isDeleted = Boolean(isDeleted);

    const updated = await prisma.transaction.update({ where: { id }, data });
    res.json(updated);
  } catch (err) {
    console.error("PUT /api/transactions/:id error:", err);
    if (err.code === "P2025") return res.status(404).json({ error: "Transaction not found" });
    res.status(500).json({ error: "Failed to update transaction" });
  }
});

// EDIT: delete transaction — soft delete
app.delete("/api/transactions/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    await prisma.transaction.update({ where: { id }, data: { isDeleted: true } }); // soft delete
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/transactions/:id error:", err);
    if (err.code === "P2025") return res.status(404).json({ error: "Transaction not found" });
    res.status(500).json({ error: "Failed to delete transaction" });
  }
});

// EDIT: summary — exclude soft-deleted, support user/account/categoryId and Decimal sums
app.get("/api/summary", async (req, res) => {
  try {
    const { type, category, month, accountId, userId, categoryId } = req.query;
    const baseWhere = { isDeleted: false };

    if (type === "income" || type === "expense") baseWhere.type = type;
    if (category) baseWhere.category = String(category);
    if (accountId) baseWhere.accountId = Number(accountId);
    if (userId) baseWhere.userId = Number(userId);
    if (categoryId) baseWhere.categoryId = Number(categoryId);

    const range = monthRange(month);
    if (range) baseWhere.date = { gte: range.start, lt: range.end };

    const incomeAgg = await prisma.transaction.aggregate({
      where: { ...baseWhere, type: "income" },
      _sum: { amount: true },
      _count: { _all: true },
    });
    const expenseAgg = await prisma.transaction.aggregate({
      where: { ...baseWhere, type: "expense" },
      _sum: { amount: true },
      _count: { _all: true },
    });

    const toNum = (d) => (d ? parseFloat(d.toString()) : 0);
    const totalIncome = toNum(incomeAgg._sum.amount);
    const totalExpense = toNum(expenseAgg._sum.amount);
    const balance = totalIncome - totalExpense;
    const usagePercent = totalIncome > 0 ? Math.min(100, (totalExpense / totalIncome) * 100) : 0;

    res.json({
      totalIncome,
      totalExpense,
      balance,
      usagePercent,
      counts: { income: incomeAgg._count._all, expense: expenseAgg._count._all },
    });
  } catch (err) {
    console.error("GET /api/summary error:", err);
    res.status(500).json({ error: "Failed to fetch summary" });
  }
});

// Global error handler (fallback)
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Expense API listening on http://localhost:${PORT}`);
});