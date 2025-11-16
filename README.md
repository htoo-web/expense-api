# Expense API (Express + Prisma + SQLite)

A minimal backend API for tracking income and expenses with filtering and summary calculations. Built with Express, Prisma ORM, and SQLite.

## Stack

- Express (REST API)
- Prisma ORM
- SQLite (file-based DB)
- CORS enabled (for local frontend integration)

## Prerequisites

- Node.js 18+ (recommended)
- npm
- Prisma CLI (installed via `npm install prisma @prisma/client`)

## Project Structure

- `index.js` — Express server and REST routes
- `prisma/schema.prisma` — Prisma data model (Transaction)
- `.env` — Environment variables (SQLite file path and port)
- `scripts/seed.js` — Optional seeding script with demo data

## Environment

Create `.env` at the project root: