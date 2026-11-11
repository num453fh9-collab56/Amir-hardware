/* Neon Postgres client — HTTP-based, safe for serverless. */

const fs = require("fs");
const path = require("path");
const { neon } = require("@neondatabase/serverless");

// Strip BOM / whitespace injected by PowerShell env pipelines.
function clean(v) { return String(v || "").replace(/^﻿/, "").trim(); }
const DATABASE_URL = clean(process.env.DATABASE_URL);

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL env var is required (Neon Postgres connection string).");
}

const sql = neon(DATABASE_URL);

/* Thin wrappers to keep handler sites close to the old node:sqlite shape:
   - one()   → first row or null
   - all()   → array of rows
   - run()   → use RETURNING id in SQL to get { lastInsertRowid } */
async function one(text, params = []) {
  const rows = await sql.query(text, params);
  return rows[0] || null;
}
async function all(text, params = []) {
  return await sql.query(text, params);
}
async function run(text, params = []) {
  const rows = await sql.query(text, params);
  return { lastInsertRowid: rows && rows[0] ? rows[0].id : undefined, rows };
}

/* One-time schema init + seed. Idempotent — safe to call every cold start. */
let initPromise = null;
function init() {
  if (!initPromise) initPromise = (async () => {
    const schemaPath = path.join(__dirname, "schema.sql");
    const schemaSql = fs.readFileSync(schemaPath, "utf8");
    // Neon HTTP driver doesn't support multi-statement; split on ';' crudely.
    const statements = schemaSql
      .split(/;\s*$/m)
      .map(s => s.trim())
      .filter(s => s.length > 0);
    for (const stmt of statements) {
      try { await sql.query(stmt); }
      catch (e) { console.error("[schema]", e.message, "\n", stmt.slice(0, 80)); throw e; }
    }
    await seed();
  })();
  return initPromise;
}

async function seed() {
  // Seed admin
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@amirhardware.com").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminPassword) {
    const { rows } = { rows: await sql.query("SELECT id FROM admins WHERE email = $1", [adminEmail]) };
    if (rows.length === 0) {
      const bcrypt = require("bcryptjs");
      const hash = bcrypt.hashSync(adminPassword, 10);
      await sql.query(
        "INSERT INTO admins (email, password, name) VALUES ($1, $2, $3)",
        [adminEmail, hash, "Amir Hardware Admin"]
      );
      console.log("[seed] Admin created:", adminEmail);
    }
  }

  // Seed coupons
  const SEED_COUPONS = [
    ["FIRST10", "First order 10% off", "percent", 10, 1000, 500, 0],
    ["BULK500", "Rs 500 off on 5000+", "fixed", 500, 5000, 500, 0],
    ["WELCOME100", "Rs 100 off new customers", "fixed", 100, 800, 100, 0],
    ["CONTRACTOR15", "Contractor 15% off bulk", "percent", 15, 10000, 2500, 0]
  ];
  for (const [code, label, type, value, min, max, limit] of SEED_COUPONS) {
    const existing = await sql.query("SELECT id FROM coupons WHERE code = $1", [code]);
    if (existing.length === 0) {
      await sql.query(
        "INSERT INTO coupons (code, label, type, value, min_subtotal, max_discount, usage_limit) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [code, label, type, value, min, max, limit]
      );
    }
  }
}

module.exports = { sql, one, all, run, init };
