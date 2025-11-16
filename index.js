// ... existing code ...
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

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

// List transactions with optional filters: ?type=income|expense&category=...&month=YYYY-MM
app.get("/api/transactions", async (req, res) => {
  try {
    const { type, category, month } = req.query;
    const where = {};

    if (type === "income" || type === "expense") where.type = type;
    if (category) where.category = String(category);

    const range = monthRange(month);
    if (range) {
      where.date = { gte: range.start, lt: range.end };
    }

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
    });

    res.json(transactions);
  } catch (err) {
    console.error("GET /api/transactions error:", err);
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// Create transaction: { type, date, category, description?, amount }
app.post("/api/transactions", async (req, res) => {
  try {
    const { type, date, category, description, amount } = req.body;

    if (type !== "income" && type !== "expense") {
      return res.status(400).json({ error: "Invalid type" });
    }
    const amountNum = Number(amount);
    if (!date || !category || Number.isNaN(amountNum)) {
      return res.status(400).json({ error: "Missing or invalid fields" });
    }

    const created = await prisma.transaction.create({
      data: {
        type,
        date: new Date(date),
        category,
        description: description ?? null,
        amount: amountNum,
      },
    });

    res.status(201).json(created);
  } catch (err) {
    console.error("POST /api/transactions error:", err);
    res.status(500).json({ error: "Failed to create transaction" });
  }
});

// Update transaction by id
app.put("/api/transactions/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    const { type, date, category, description, amount } = req.body;

    const data = {};
    if (type === "income" || type === "expense") data.type = type;
    if (date) data.date = new Date(date);
    if (category) data.category = category;
    if (typeof description !== "undefined") data.description = description ?? null;
    if (typeof amount !== "undefined") {
      const amountNum = Number(amount);
      if (Number.isNaN(amountNum)) return res.status(400).json({ error: "Invalid amount" });
      data.amount = amountNum;
    }

    const updated = await prisma.transaction.update({
      where: { id },
      data,
    });

    res.json(updated);
  } catch (err) {
    console.error("PUT /api/transactions/:id error:", err);
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Transaction not found" });
    }
    res.status(500).json({ error: "Failed to update transaction" });
  }
});

// Delete transaction by id
app.delete("/api/transactions/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid id" });

    await prisma.transaction.delete({ where: { id } });
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/transactions/:id error:", err);
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Transaction not found" });
    }
    res.status(500).json({ error: "Failed to delete transaction" });
  }
});

// Summary: totals for the current filter (month/category/type)
app.get("/api/summary", async (req, res) => {
  try {
    const { type, category, month } = req.query;
    const baseWhere = {};
    if (type === "income" || type === "expense") baseWhere.type = type;
    if (category) baseWhere.category = String(category);

    const range = monthRange(month);
    if (range) {
      baseWhere.date = { gte: range.start, lt: range.end };
    }

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

    const totalIncome = Number(incomeAgg._sum.amount ?? 0);
    const totalExpense = Number(expenseAgg._sum.amount ?? 0);
    const balance = totalIncome - totalExpense;
    const usagePercent = totalIncome > 0 ? Math.min(100, (totalExpense / totalIncome) * 100) : 0;

    res.json({
      totalIncome,
      totalExpense,
      balance,
      usagePercent,
      counts: {
        income: incomeAgg._count._all,
        expense: expenseAgg._count._all,
      },
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
// ... existing code ...