/* Run once to initialize Postgres schema + seed admin/coupons.
   Usage:  node api/lib/init-db.js */
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env.local") });
const db = require("./db");

(async () => {
  try {
    console.log("[init] Running schema migrations against Neon…");
    await db.init();
    const counts = await db.all("SELECT (SELECT COUNT(*) FROM products)::int AS products, (SELECT COUNT(*) FROM admins)::int AS admins, (SELECT COUNT(*) FROM coupons)::int AS coupons");
    console.log("[init] Done:", counts[0]);
    process.exit(0);
  } catch (e) {
    console.error("[init] FAILED:", e.message);
    process.exit(1);
  }
})();
