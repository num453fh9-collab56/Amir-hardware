/* ============================================================
   AMIR HARDWARE — Backend (Express)
   Postgres (Neon) + Vercel Blob + Resend + JWT
   Serverless-ready: exports app; starts a listener only when run directly.
   ============================================================ */

const path = require("path");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

const db = require("./lib/db");
const email = require("./lib/email");
const { uploadImage, ALLOWED_MIMES, ALLOWED_EXTS } = require("./lib/upload");

function cleanEnv(v) { return String(v || "").replace(/^﻿/, "").trim(); }
const IS_PROD = process.env.NODE_ENV === "production";
const JWT_SECRET = cleanEnv(process.env.JWT_SECRET);
if (!JWT_SECRET) {
  const msg = "JWT_SECRET env var is required.";
  if (IS_PROD) { console.error("[fatal]", msg); process.exit(1); }
  else console.warn("[warn]", msg, "Using insecure dev fallback.");
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || "dev-insecure-change-me";

if (IS_PROD && !process.env.ADMIN_PASSWORD) {
  console.error("[fatal] ADMIN_PASSWORD env var is required in production.");
  process.exit(1);
}

/* ---------- lazy schema init on first request (serverless cold start) ---------- */
let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await db.init();
  schemaReady = true;
}

const app = express();
app.set("trust proxy", 1);

/* ---------- CORS allowlist ---------- */
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true);
    if (CORS_ORIGINS.length === 0) return cb(null, true);
    if (CORS_ORIGINS.indexOf(origin) >= 0) return cb(null, true);
    return cb(new Error("Origin not allowed"), false);
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

/* ---------- ensure DB ready on every API request ---------- */
app.use(async function (req, res, next) {
  try { await ensureSchema(); next(); }
  catch (e) { console.error("[schema init]", e); res.status(500).json({ error: "Database unavailable." }); }
});

/* ---------- multer memory storage + strict filter ---------- */
const fileFilter = function (req, file, cb) {
  const mime = String(file.mimetype || "").toLowerCase();
  const ext = path.extname(file.originalname || "").toLowerCase();
  if (ALLOWED_MIMES.has(mime) && ALLOWED_EXTS.has(ext)) return cb(null, true);
  return cb(new Error("Only JPEG, PNG, GIF, WEBP or AVIF images are allowed."), false);
};
const upload = multer({ storage: multer.memoryStorage(), fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

/* ---------- rate limiters ---------- */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again in 15 minutes." }
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many signup attempts. Please try again later." }
});
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many messages. Please try again later." }
});

/* ---------- JWT helpers ---------- */
function signAdminToken(admin) {
  return jwt.sign({ id: admin.id, email: admin.email, name: admin.name }, EFFECTIVE_JWT_SECRET, { expiresIn: "7d" });
}
function signUserToken(user) {
  return jwt.sign({ uid: user.id, phone: user.phone, name: user.name, kind: "user" }, EFFECTIVE_JWT_SECRET, { expiresIn: "30d" });
}
function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token. Please log in." });
  try { req.admin = jwt.verify(token, EFFECTIVE_JWT_SECRET); next(); }
  catch (e) { return res.status(401).json({ error: "Invalid or expired token. Please log in again." }); }
}
function userAuthRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Login required." });
  try {
    const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET);
    if (decoded.kind !== "user") return res.status(401).json({ error: "Not a user token." });
    req.user = decoded; next();
  } catch (e) { return res.status(401).json({ error: "Session expired. Please log in again." }); }
}

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (!digits) return "";
  if (digits.startsWith("92")) return digits;
  if (digits.startsWith("03")) return "92" + digits.slice(1);
  if (digits.startsWith("3") && digits.length === 10) return "92" + digits;
  return digits;
}

function deliveryFeeForCity(city) {
  const c = String(city || "").toLowerCase().trim();
  if (!c) return 300;
  if (/habibabad|pattoki|okara|chunian|kasur/i.test(c)) return 0;
  if (/lahore|sheikhupura|nankana|renala/i.test(c)) return 250;
  if (/faisalabad|multan|gujranwala|sialkot/i.test(c)) return 400;
  if (/karachi|islamabad|rawalpindi|peshawar|quetta/i.test(c)) return 600;
  return 350;
}

function generateOrderCode() {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return "AH-" + t.slice(-5) + "-" + r;
}

/* ---------- product serializer ---------- */
async function toPublic(p) {
  const imgRows = await db.all(
    "SELECT image FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC, id ASC",
    [p.id]
  );
  const gallery = imgRows.map(r => r.image);
  const ratingRow = await db.one(
    "SELECT ROUND(AVG(rating)::numeric, 1)::float AS avg, COUNT(*)::int AS cnt FROM reviews WHERE product_id = $1",
    [p.id]
  );
  const mainImg = p.image || null;
  const images = [];
  if (mainImg) images.push(mainImg);
  gallery.forEach(g => { if (images.indexOf(g) < 0) images.push(g); });
  return {
    id: p.id,
    title: p.title,
    category: p.category,
    brand: p.brand || "",
    price: Number(p.price),
    description: p.description,
    image: mainImg,
    images,
    inStock: Number(p.in_stock) === 1,
    stockQty: p.stock_qty == null ? null : Number(p.stock_qty),
    rating: Number(ratingRow && ratingRow.avg) || 0,
    reviewCount: Number(ratingRow && ratingRow.cnt) || 0,
    flashDiscountPct: Number(p.flash_discount_pct) || 0,
    isDealOfDay: Number(p.is_deal_of_day) === 1,
    createdAt: p.created_at
  };
}

function toOrderPublic(order, items) {
  return {
    id: order.id,
    orderCode: order.order_code,
    subtotal: Number(order.subtotal),
    deliveryFee: Number(order.delivery_fee),
    total: Number(order.total),
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    status: order.status,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    addressLine: order.address_line,
    city: order.city,
    notes: order.notes || "",
    deliveryDate: order.delivery_date || "",
    courier: order.courier || "",
    trackingNumber: order.tracking_number || "",
    deliverySlot: order.delivery_slot || "",
    estimatedDelivery: order.estimated_delivery || "",
    couponCode: order.coupon_code || "",
    discountAmount: Number(order.discount_amount) || 0,
    pointsEarned: Number(order.points_earned) || 0,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: (items || []).map(it => ({
      id: it.id,
      productId: it.product_id,
      title: it.title,
      brand: it.brand,
      price: Number(it.price),
      qty: Number(it.qty),
      image: it.image || null
    }))
  };
}

function computeCouponDiscount(coupon, subtotal) {
  if (!coupon || Number(coupon.active) === 0) return { discount: 0, error: "Invalid or expired coupon." };
  if (Number(coupon.min_subtotal) && subtotal < Number(coupon.min_subtotal)) {
    return { discount: 0, error: "Minimum order Rs " + coupon.min_subtotal + " required." };
  }
  if (Number(coupon.usage_limit) && Number(coupon.used_count) >= Number(coupon.usage_limit)) {
    return { discount: 0, error: "This coupon has reached its usage limit." };
  }
  if (coupon.expires_at) {
    const exp = new Date(coupon.expires_at);
    if (!isNaN(exp) && exp < new Date()) return { discount: 0, error: "This coupon has expired." };
  }
  let discount = coupon.type === "percent"
    ? Math.round(subtotal * Number(coupon.value) / 100)
    : Number(coupon.value);
  if (Number(coupon.max_discount) > 0) discount = Math.min(discount, Number(coupon.max_discount));
  return { discount: Math.max(0, discount), error: null };
}

/* ============================================================
   AUTH — admin
   ============================================================ */
app.post("/api/auth/login", loginLimiter, async function (req, res) {
  const { email: emailVal, password } = req.body || {};
  if (!emailVal || !password) return res.status(400).json({ error: "Email and password are required." });
  const admin = await db.one("SELECT * FROM admins WHERE email = $1", [String(emailVal).toLowerCase().trim()]);
  if (!admin || !bcrypt.compareSync(String(password), admin.password)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  res.json({ token: signAdminToken(admin), admin: { id: admin.id, name: admin.name, email: admin.email } });
});

/* ============================================================
   AUTH — user (customer)
   ============================================================ */
app.post("/api/user/register", registerLimiter, async function (req, res) {
  const { name, phone, email: emailVal, password, city } = req.body || {};
  if (!name || !phone || !password) return res.status(400).json({ error: "Name, phone and password are required." });
  if (String(password).length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  const normPhone = normalizePhone(phone);
  if (!normPhone || normPhone.length < 10) return res.status(400).json({ error: "Please enter a valid phone number." });
  const existing = await db.one("SELECT id FROM users WHERE phone = $1", [normPhone]);
  if (existing) return res.status(409).json({ error: "This phone number is already registered. Please log in." });
  const hash = bcrypt.hashSync(String(password), 10);
  const inserted = await db.run(
    "INSERT INTO users (phone, email, name, password, city) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [normPhone, emailVal ? String(emailVal).trim().toLowerCase() : null, String(name).trim(), hash, city ? String(city).trim() : ""]
  );
  const user = await db.one("SELECT id, name, phone, email, city FROM users WHERE id = $1", [inserted.lastInsertRowid]);
  res.status(201).json({ token: signUserToken(user), user });
});

app.post("/api/user/login", loginLimiter, async function (req, res) {
  const { phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ error: "Phone and password are required." });
  const normPhone = normalizePhone(phone);
  const user = await db.one("SELECT * FROM users WHERE phone = $1", [normPhone]);
  if (!user || !bcrypt.compareSync(String(password), user.password)) {
    return res.status(401).json({ error: "Invalid phone or password." });
  }
  res.json({ token: signUserToken(user), user: { id: user.id, name: user.name, phone: user.phone, email: user.email, city: user.city } });
});

app.get("/api/user/me", userAuthRequired, async function (req, res) {
  const user = await db.one("SELECT id, name, phone, email, city FROM users WHERE id = $1", [req.user.uid]);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user });
});

/* ============================================================
   PRODUCTS
   ============================================================ */
app.get("/api/products", async function (req, res) {
  const rows = await db.all("SELECT * FROM products ORDER BY created_at DESC, id DESC");
  const results = [];
  for (const r of rows) results.push(await toPublic(r));
  res.json(results);
});

app.post("/api/products", authRequired, upload.single("image"), async function (req, res) {
  const { title, category, brand, price, description, in_stock } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "Title is required." });
  const imageUrl = req.file ? await uploadImage(req.file) : null;
  const inserted = await db.run(
    "INSERT INTO products (title, category, brand, price, description, image, in_stock) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
    [
      title.trim(),
      (category || "General").trim(),
      (brand || "").trim(),
      Number(price) || 0,
      (description || "").trim(),
      imageUrl,
      in_stock === undefined ? 1 : Number(in_stock)
    ]
  );
  const row = await db.one("SELECT * FROM products WHERE id = $1", [inserted.lastInsertRowid]);
  res.status(201).json(await toPublic(row));
});

app.put("/api/products/:id", authRequired, upload.single("image"), async function (req, res) {
  const id = Number(req.params.id);
  const existingRow = await db.one("SELECT * FROM products WHERE id = $1", [id]);
  if (!existingRow) return res.status(404).json({ error: "Product not found." });
  const { title, category, brand, price, description, in_stock } = req.body;
  const inStock = in_stock === undefined ? existingRow.in_stock : Number(in_stock);
  let image = existingRow.image;
  if (req.file) image = await uploadImage(req.file);
  await db.run(
    "UPDATE products SET title=$1, category=$2, brand=$3, price=$4, description=$5, image=$6, in_stock=$7 WHERE id=$8",
    [
      title && title.trim() ? title.trim() : existingRow.title,
      (category || existingRow.category).trim(),
      brand && brand.trim() ? brand.trim() : (existingRow.brand || existingRow.category),
      price === undefined || price === "" ? existingRow.price : Number(price),
      description === undefined ? existingRow.description : String(description).trim(),
      image,
      inStock,
      id
    ]
  );
  const row = await db.one("SELECT * FROM products WHERE id = $1", [id]);
  res.json(await toPublic(row));
});

app.delete("/api/products/:id", authRequired, async function (req, res) {
  const id = Number(req.params.id);
  const row = await db.one("SELECT * FROM products WHERE id = $1", [id]);
  if (!row) return res.status(404).json({ error: "Product not found." });
  await db.run("DELETE FROM products WHERE id = $1", [id]);
  res.json({ ok: true, message: "Product deleted." });
});

app.patch("/api/products/:id/flash", authRequired, async function (req, res) {
  const id = Number(req.params.id);
  const row = await db.one("SELECT * FROM products WHERE id = $1", [id]);
  if (!row) return res.status(404).json({ error: "Product not found." });
  const { flashDiscountPct, isDealOfDay } = req.body || {};
  await db.run(
    "UPDATE products SET flash_discount_pct=$1, is_deal_of_day=$2 WHERE id=$3",
    [
      flashDiscountPct === undefined ? row.flash_discount_pct : Math.max(0, Math.min(90, Number(flashDiscountPct))),
      isDealOfDay === undefined ? row.is_deal_of_day : (isDealOfDay ? 1 : 0),
      id
    ]
  );
  const updated = await db.one("SELECT * FROM products WHERE id = $1", [id]);
  res.json(await toPublic(updated));
});

app.patch("/api/products/:id/stock", authRequired, async function (req, res) {
  const id = Number(req.params.id);
  const row = await db.one("SELECT * FROM products WHERE id = $1", [id]);
  if (!row) return res.status(404).json({ error: "Product not found." });
  const { stockQty, inStock } = req.body || {};
  const qty = stockQty === undefined ? Number(row.stock_qty) : Math.max(0, Number(stockQty));
  const flag = inStock === undefined ? (qty > 0 ? 1 : 0) : (Number(inStock) ? 1 : 0);
  await db.run("UPDATE products SET stock_qty=$1, in_stock=$2 WHERE id=$3", [qty, flag, id]);
  const updated = await db.one("SELECT * FROM products WHERE id = $1", [id]);
  res.json(await toPublic(updated));
});

app.get("/api/products/:id/related", async function (req, res) {
  const id = Number(req.params.id);
  const product = await db.one("SELECT * FROM products WHERE id = $1", [id]);
  if (!product) return res.status(404).json({ error: "Product not found." });
  const sameBoth = await db.all(
    "SELECT * FROM products WHERE id <> $1 AND brand = $2 AND category = $3 LIMIT 6",
    [id, product.brand, product.category]
  );
  let picks = sameBoth.slice();
  if (picks.length < 6) {
    const sameCat = await db.all(
      "SELECT * FROM products WHERE id <> $1 AND category = $2 LIMIT $3",
      [id, product.category, 6 - picks.length + 3]
    );
    sameCat.forEach(p => { if (!picks.some(x => x.id === p.id)) picks.push(p); });
  }
  if (picks.length < 6) {
    const anyOther = await db.all(
      "SELECT * FROM products WHERE id <> $1 LIMIT $2",
      [id, 6 - picks.length + 2]
    );
    anyOther.forEach(p => { if (!picks.some(x => x.id === p.id)) picks.push(p); });
  }
  const list = picks.slice(0, 6);
  const out = [];
  for (const p of list) out.push(await toPublic(p));
  res.json(out);
});

/* ---------- product gallery ---------- */
app.post("/api/products/:id/images", authRequired, upload.single("image"), async function (req, res) {
  const id = Number(req.params.id);
  const product = await db.one("SELECT id FROM products WHERE id = $1", [id]);
  if (!product) return res.status(404).json({ error: "Product not found." });
  if (!req.file) return res.status(400).json({ error: "Image file required." });
  const imageUrl = await uploadImage(req.file);
  const maxOrder = await db.one(
    "SELECT COALESCE(MAX(sort_order), 0)::int AS m FROM product_images WHERE product_id = $1",
    [id]
  );
  const inserted = await db.run(
    "INSERT INTO product_images (product_id, image, sort_order) VALUES ($1,$2,$3) RETURNING id",
    [id, imageUrl, (maxOrder.m || 0) + 1]
  );
  res.status(201).json({ ok: true, id: inserted.lastInsertRowid, image: imageUrl });
});

app.delete("/api/products/:id/images/:imgId", authRequired, async function (req, res) {
  const id = Number(req.params.id);
  const imgId = Number(req.params.imgId);
  const row = await db.one(
    "SELECT * FROM product_images WHERE id = $1 AND product_id = $2",
    [imgId, id]
  );
  if (!row) return res.status(404).json({ error: "Image not found." });
  await db.run("DELETE FROM product_images WHERE id = $1", [imgId]);
  res.json({ ok: true });
});

/* ============================================================
   ORDERS
   ============================================================ */
app.post("/api/orders/preview", async function (req, res) {
  const { items, city } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "Cart is empty." });
  const resolved = [];
  let subtotal = 0;
  for (const it of items) {
    const p = await db.one("SELECT * FROM products WHERE id = $1", [Number(it.id)]);
    if (!p) continue;
    const qty = Math.max(1, Number(it.qty) || 1);
    const line = Number(p.price) * qty;
    subtotal += line;
    resolved.push({ productId: p.id, title: p.title, brand: p.brand, price: Number(p.price), qty, image: p.image });
  }
  const fee = deliveryFeeForCity(city);
  res.json({ subtotal, deliveryFee: fee, total: subtotal + fee, items: resolved });
});

app.post("/api/orders", userAuthRequired, async function (req, res) {
  const { items, customerName, customerPhone, addressLine, city, notes, deliveryDate, paymentMethod, couponCode } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "Cart is empty." });
  if (!customerName || !customerPhone || !addressLine || !city) {
    return res.status(400).json({ error: "Name, phone, address and city are required." });
  }
  const method = ["COD", "BANK_TRANSFER", "JAZZCASH", "EASYPAISA", "CARD"].indexOf(paymentMethod) >= 0 ? paymentMethod : "COD";

  const resolved = [];
  let subtotal = 0;
  for (const it of items) {
    const p = await db.one("SELECT * FROM products WHERE id = $1", [Number(it.id)]);
    if (!p) return res.status(400).json({ error: "Product " + it.id + " not found." });
    if (Number(p.in_stock) === 0) return res.status(400).json({ error: "\"" + p.title + "\" is out of stock." });
    const qty = Math.max(1, Number(it.qty) || 1);
    const unitPrice = Number(p.flash_discount_pct) > 0
      ? Math.round(Number(p.price) * (100 - Number(p.flash_discount_pct)) / 100)
      : Number(p.price);
    const line = unitPrice * qty;
    subtotal += line;
    resolved.push({ product_id: p.id, title: p.title, brand: p.brand || "", price: unitPrice, qty, image: p.image });
  }

  let discountAmount = 0;
  let appliedCoupon = null;
  if (couponCode) {
    const coupon = await db.one("SELECT * FROM coupons WHERE code = $1", [String(couponCode).trim().toUpperCase()]);
    if (!coupon) return res.status(400).json({ error: "Invalid coupon code." });
    const check = computeCouponDiscount(coupon, subtotal);
    if (check.error) return res.status(400).json({ error: check.error });
    discountAmount = check.discount;
    appliedCoupon = coupon;
  }

  const user = await db.one("SELECT is_contractor, email FROM users WHERE id = $1", [req.user.uid]);
  if (user && Number(user.is_contractor) === 1 && subtotal > 0) {
    discountAmount += Math.round(subtotal * 0.05);
  }

  const deliveryFee = deliveryFeeForCity(city);
  const total = Math.max(0, subtotal - discountAmount + deliveryFee);
  const orderCode = generateOrderCode();
  const pointsEarned = Math.floor(total / 100);

  const tx = await db.run(
    "INSERT INTO orders (user_id, order_code, subtotal, delivery_fee, total, payment_method, payment_status, status, customer_name, customer_phone, address_line, city, notes, delivery_date, coupon_code, discount_amount, points_earned) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id",
    [
      req.user.uid, orderCode, subtotal, deliveryFee, total, method,
      method === "COD" ? "cod_pending" : "awaiting_payment", "placed",
      String(customerName).trim(), normalizePhone(customerPhone),
      String(addressLine).trim(), String(city).trim(),
      notes ? String(notes).trim() : "",
      deliveryDate ? String(deliveryDate).trim() : "",
      appliedCoupon ? appliedCoupon.code : "",
      discountAmount, pointsEarned
    ]
  );
  const orderId = tx.lastInsertRowid;
  for (const it of resolved) {
    await db.run(
      "INSERT INTO order_items (order_id, product_id, title, brand, price, qty, image) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [orderId, it.product_id, it.title, it.brand, it.price, it.qty, it.image]
    );
  }
  if (appliedCoupon) {
    await db.run(
      "INSERT INTO coupon_uses (coupon_id, user_id, order_id, applied_amount) VALUES ($1,$2,$3,$4)",
      [appliedCoupon.id, req.user.uid, orderId, discountAmount]
    );
    await db.run("UPDATE coupons SET used_count = used_count + 1 WHERE id = $1", [appliedCoupon.id]);
  }
  if (pointsEarned > 0) {
    await db.run(
      "INSERT INTO point_transactions (user_id, order_id, points, type, description) VALUES ($1,$2,$3,'earn',$4)",
      [req.user.uid, orderId, pointsEarned, "Order " + orderCode]
    );
    await db.run("UPDATE users SET loyalty_points = loyalty_points + $1 WHERE id = $2", [pointsEarned, req.user.uid]);
  }

  const order = await db.one("SELECT * FROM orders WHERE id = $1", [orderId]);
  const orderItems = await db.all("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [orderId]);
  const payload = toOrderPublic(order, orderItems);

  // Fire-and-forget emails (don't block response)
  (async () => {
    try { await email.sendOrderAlertToShop(payload); } catch (e) { console.error("[email alert]", e); }
    if (user && user.email) {
      try { await email.sendOrderConfirmationToCustomer(user.email, payload); } catch (e) { console.error("[email customer]", e); }
    }
  })();

  res.status(201).json(payload);
});

app.get("/api/orders/mine", userAuthRequired, async function (req, res) {
  const orders = await db.all("SELECT * FROM orders WHERE user_id = $1 ORDER BY id DESC", [req.user.uid]);
  const out = [];
  for (const o of orders) {
    const items = await db.all("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [o.id]);
    out.push(toOrderPublic(o, items));
  }
  res.json(out);
});

app.get("/api/orders/:id", async function (req, res) {
  const id = Number(req.params.id);
  const order = await db.one("SELECT * FROM orders WHERE id = $1", [id]);
  if (!order) return res.status(404).json({ error: "Order not found." });
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  let allowed = false;
  if (token) {
    try {
      const decoded = jwt.verify(token, EFFECTIVE_JWT_SECRET);
      if (decoded.kind === "user" && decoded.uid === order.user_id) allowed = true;
      if (decoded.kind !== "user" && decoded.id) allowed = true;
    } catch (e) { /* ignore */ }
  }
  if (!allowed) return res.status(403).json({ error: "You cannot view this order." });
  const items = await db.all("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [id]);
  res.json(toOrderPublic(order, items));
});

app.get("/api/orders/:id/reorder", userAuthRequired, async function (req, res) {
  const id = Number(req.params.id);
  const order = await db.one("SELECT * FROM orders WHERE id = $1 AND user_id = $2", [id, req.user.uid]);
  if (!order) return res.status(404).json({ error: "Order not found." });
  const items = await db.all("SELECT * FROM order_items WHERE order_id = $1", [id]);
  const result = [];
  for (const it of items) {
    const p = await db.one("SELECT * FROM products WHERE id = $1", [it.product_id]);
    if (p && Number(p.in_stock) === 1) {
      result.push({ id: p.id, title: p.title, price: Number(p.price), qty: it.qty, image: p.image, available: true });
    } else if (p) {
      result.push({ id: p.id, title: p.title, price: Number(p.price), qty: it.qty, image: p.image, available: false });
    } else {
      result.push({ id: it.product_id, title: it.title, price: Number(it.price), qty: it.qty, image: null, available: false, removed: true });
    }
  }
  res.json({ items: result });
});

app.get("/api/admin/orders", authRequired, async function (req, res) {
  const orders = await db.all(
    "SELECT o.*, u.name AS _user_name, u.phone AS _user_phone FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id DESC"
  );
  const out = [];
  for (const o of orders) {
    const items = await db.all("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [o.id]);
    const base = toOrderPublic(o, items);
    base.userName = o._user_name;
    base.userPhone = o._user_phone;
    out.push(base);
  }
  res.json(out);
});

app.put("/api/admin/orders/:id/status", authRequired, async function (req, res) {
  const id = Number(req.params.id);
  const { status, paymentStatus } = req.body || {};
  const row = await db.one("SELECT * FROM orders WHERE id = $1", [id]);
  if (!row) return res.status(404).json({ error: "Order not found." });
  const validStatus = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled"];
  const validPayment = ["cod_pending", "awaiting_payment", "paid", "failed", "refunded"];
  const newStatus = validStatus.indexOf(status) >= 0 ? status : row.status;
  const newPaymentStatus = validPayment.indexOf(paymentStatus) >= 0 ? paymentStatus : row.payment_status;
  await db.run(
    "UPDATE orders SET status=$1, payment_status=$2, updated_at=NOW() WHERE id=$3",
    [newStatus, newPaymentStatus, id]
  );
  const updated = await db.one("SELECT * FROM orders WHERE id = $1", [id]);
  const items = await db.all("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [id]);
  res.json(toOrderPublic(updated, items));
});

app.put("/api/admin/orders/:id/tracking", authRequired, async function (req, res) {
  const id = Number(req.params.id);
  const row = await db.one("SELECT * FROM orders WHERE id = $1", [id]);
  if (!row) return res.status(404).json({ error: "Order not found." });
  const { courier, trackingNumber, deliverySlot, estimatedDelivery } = req.body || {};
  await db.run(
    "UPDATE orders SET courier=$1, tracking_number=$2, delivery_slot=$3, estimated_delivery=$4, updated_at=NOW() WHERE id=$5",
    [
      courier === undefined ? row.courier : String(courier || "").trim(),
      trackingNumber === undefined ? row.tracking_number : String(trackingNumber || "").trim(),
      deliverySlot === undefined ? row.delivery_slot : String(deliverySlot || "").trim(),
      estimatedDelivery === undefined ? row.estimated_delivery : String(estimatedDelivery || "").trim(),
      id
    ]
  );
  const updated = await db.one("SELECT * FROM orders WHERE id = $1", [id]);
  const items = await db.all("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id", [id]);
  res.json(toOrderPublic(updated, items));
});

/* ============================================================
   COUPONS
   ============================================================ */
app.post("/api/coupons/validate", async function (req, res) {
  const { code, subtotal } = req.body || {};
  if (!code) return res.status(400).json({ valid: false, error: "Coupon code required." });
  const coupon = await db.one("SELECT * FROM coupons WHERE code = $1", [String(code).trim().toUpperCase()]);
  if (!coupon) return res.status(404).json({ valid: false, error: "Invalid coupon code." });
  const check = computeCouponDiscount(coupon, Number(subtotal) || 0);
  if (check.error) return res.status(400).json({ valid: false, error: check.error });
  res.json({
    valid: true, code: coupon.code, label: coupon.label, type: coupon.type,
    value: Number(coupon.value), discount: check.discount
  });
});

app.get("/api/coupons/public", async function (req, res) {
  const rows = await db.all(
    "SELECT code, label, type, value, min_subtotal, max_discount, expires_at FROM coupons WHERE active = 1 ORDER BY id DESC LIMIT 10"
  );
  res.json(rows);
});

app.get("/api/admin/coupons", authRequired, async function (req, res) {
  res.json(await db.all("SELECT * FROM coupons ORDER BY id DESC"));
});

app.post("/api/admin/coupons", authRequired, async function (req, res) {
  const { code, label, type, value, min_subtotal, max_discount, usage_limit, starts_at, expires_at, active } = req.body || {};
  if (!code || !type || value === undefined) return res.status(400).json({ error: "Code, type and value required." });
  const codeNorm = String(code).trim().toUpperCase();
  const existing = await db.one("SELECT id FROM coupons WHERE code = $1", [codeNorm]);
  if (existing) return res.status(409).json({ error: "Coupon code already exists." });
  const inserted = await db.run(
    "INSERT INTO coupons (code, label, type, value, min_subtotal, max_discount, usage_limit, starts_at, expires_at, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
    [
      codeNorm, String(label || "").trim(), type === "fixed" ? "fixed" : "percent",
      Number(value) || 0, Number(min_subtotal) || 0, Number(max_discount) || 0,
      Number(usage_limit) || 0, String(starts_at || "").trim(), String(expires_at || "").trim(),
      active === false ? 0 : 1
    ]
  );
  const row = await db.one("SELECT * FROM coupons WHERE id = $1", [inserted.lastInsertRowid]);
  res.status(201).json(row);
});

app.put("/api/admin/coupons/:id", authRequired, async function (req, res) {
  const id = Number(req.params.id);
  const row = await db.one("SELECT * FROM coupons WHERE id = $1", [id]);
  if (!row) return res.status(404).json({ error: "Coupon not found." });
  const { label, type, value, min_subtotal, max_discount, usage_limit, starts_at, expires_at, active } = req.body || {};
  await db.run(
    "UPDATE coupons SET label=$1, type=$2, value=$3, min_subtotal=$4, max_discount=$5, usage_limit=$6, starts_at=$7, expires_at=$8, active=$9 WHERE id=$10",
    [
      label === undefined ? row.label : String(label).trim(),
      type === undefined ? row.type : (type === "fixed" ? "fixed" : "percent"),
      value === undefined ? row.value : Number(value),
      min_subtotal === undefined ? row.min_subtotal : Number(min_subtotal),
      max_discount === undefined ? row.max_discount : Number(max_discount),
      usage_limit === undefined ? row.usage_limit : Number(usage_limit),
      starts_at === undefined ? row.starts_at : String(starts_at).trim(),
      expires_at === undefined ? row.expires_at : String(expires_at).trim(),
      active === undefined ? row.active : (active ? 1 : 0),
      id
    ]
  );
  res.json(await db.one("SELECT * FROM coupons WHERE id = $1", [id]));
});

app.delete("/api/admin/coupons/:id", authRequired, async function (req, res) {
  const id = Number(req.params.id);
  const row = await db.one("SELECT * FROM coupons WHERE id = $1", [id]);
  if (!row) return res.status(404).json({ error: "Coupon not found." });
  await db.run("DELETE FROM coupons WHERE id = $1", [id]);
  res.json({ ok: true });
});

/* ============================================================
   LOYALTY / NEWSLETTER / REVIEWS / ADDRESSES / PROFILE
   ============================================================ */
app.get("/api/user/points", userAuthRequired, async function (req, res) {
  const user = await db.one("SELECT loyalty_points FROM users WHERE id = $1", [req.user.uid]);
  const txs = await db.all(
    "SELECT * FROM point_transactions WHERE user_id = $1 ORDER BY id DESC LIMIT 50",
    [req.user.uid]
  );
  res.json({
    balance: (user && Number(user.loyalty_points)) || 0,
    rupeeValue: Math.floor(((user && Number(user.loyalty_points)) || 0) / 10),
    transactions: txs.map(t => ({ id: t.id, points: t.points, type: t.type, description: t.description, createdAt: t.created_at }))
  });
});

app.post("/api/newsletter/subscribe", async function (req, res) {
  const { email: emailVal, phone, source } = req.body || {};
  if (!emailVal) return res.status(400).json({ error: "Email required." });
  const emailNorm = String(emailVal).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) return res.status(400).json({ error: "Please enter a valid email." });
  const existing = await db.one("SELECT id FROM newsletter_subs WHERE email = $1", [emailNorm]);
  if (existing) return res.json({ ok: true, alreadySubscribed: true });
  await db.run(
    "INSERT INTO newsletter_subs (email, phone, source) VALUES ($1,$2,$3)",
    [emailNorm, phone ? normalizePhone(phone) : "", String(source || "footer").trim()]
  );
  res.status(201).json({ ok: true });
});

app.get("/api/admin/newsletter", authRequired, async function (req, res) {
  res.json(await db.all("SELECT * FROM newsletter_subs ORDER BY id DESC LIMIT 1000"));
});

app.get("/api/reviews", async function (req, res) {
  const productId = Number(req.query.productId);
  if (!productId) return res.status(400).json({ error: "productId is required." });
  const rows = await db.all(
    "SELECT r.*, u.name AS user_name FROM reviews r LEFT JOIN users u ON u.id = r.user_id WHERE r.product_id = $1 ORDER BY r.id DESC LIMIT 50",
    [productId]
  );
  const summary = await db.one(
    "SELECT ROUND(AVG(rating)::numeric, 1)::float AS avg, COUNT(*)::int AS cnt FROM reviews WHERE product_id = $1",
    [productId]
  );
  const dist = [0, 0, 0, 0, 0];
  const distRows = await db.all(
    "SELECT rating, COUNT(*)::int AS c FROM reviews WHERE product_id = $1 GROUP BY rating",
    [productId]
  );
  distRows.forEach(r => { if (r.rating >= 1 && r.rating <= 5) dist[r.rating - 1] = r.c; });
  res.json({
    average: Number(summary && summary.avg) || 0,
    count: (summary && Number(summary.cnt)) || 0,
    distribution: dist,
    reviews: rows.map(r => ({
      id: r.id, userName: r.user_name || "Customer", rating: r.rating,
      title: r.title, body: r.body, verifiedPurchase: Number(r.verified_purchase) === 1, createdAt: r.created_at
    }))
  });
});

app.post("/api/reviews", userAuthRequired, async function (req, res) {
  const { productId, rating, title, body } = req.body || {};
  const pid = Number(productId);
  const r = Math.max(1, Math.min(5, Number(rating) || 0));
  if (!pid || !r) return res.status(400).json({ error: "productId and rating (1-5) are required." });
  const prod = await db.one("SELECT id FROM products WHERE id = $1", [pid]);
  if (!prod) return res.status(404).json({ error: "Product not found." });
  const bought = await db.one(
    "SELECT COUNT(*)::int AS c FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.user_id = $1 AND oi.product_id = $2 AND o.status <> 'cancelled'",
    [req.user.uid, pid]
  );
  const verified = bought && bought.c > 0 ? 1 : 0;
  const existing = await db.one("SELECT id FROM reviews WHERE user_id = $1 AND product_id = $2", [req.user.uid, pid]);
  if (existing) {
    await db.run(
      "UPDATE reviews SET rating=$1, title=$2, body=$3, verified_purchase=$4, created_at=NOW() WHERE id=$5",
      [r, String(title || "").trim(), String(body || "").trim(), verified, existing.id]
    );
    const row = await db.one("SELECT * FROM reviews WHERE id = $1", [existing.id]);
    return res.json({ ok: true, review: row, updated: true });
  }
  const inserted = await db.run(
    "INSERT INTO reviews (product_id, user_id, rating, title, body, verified_purchase) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [pid, req.user.uid, r, String(title || "").trim(), String(body || "").trim(), verified]
  );
  const row = await db.one("SELECT * FROM reviews WHERE id = $1", [inserted.lastInsertRowid]);
  res.status(201).json({ ok: true, review: row });
});

app.put("/api/user/profile", userAuthRequired, async function (req, res) {
  const { name, email: emailVal, city } = req.body || {};
  const row = await db.one("SELECT * FROM users WHERE id = $1", [req.user.uid]);
  if (!row) return res.status(404).json({ error: "User not found." });
  await db.run(
    "UPDATE users SET name=$1, email=$2, city=$3 WHERE id=$4",
    [
      name && String(name).trim() ? String(name).trim() : row.name,
      emailVal === undefined ? row.email : (emailVal ? String(emailVal).trim().toLowerCase() : null),
      city === undefined ? row.city : String(city).trim(),
      req.user.uid
    ]
  );
  const user = await db.one("SELECT id, name, phone, email, city FROM users WHERE id = $1", [req.user.uid]);
  res.json({ user });
});

app.put("/api/user/password", userAuthRequired, async function (req, res) {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Current and new password are required." });
  if (String(newPassword).length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });
  const row = await db.one("SELECT * FROM users WHERE id = $1", [req.user.uid]);
  if (!row || !bcrypt.compareSync(String(currentPassword), row.password)) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }
  const hash = bcrypt.hashSync(String(newPassword), 10);
  await db.run("UPDATE users SET password = $1 WHERE id = $2", [hash, req.user.uid]);
  res.json({ ok: true });
});

/* ---------- addresses ---------- */
function toAddrPublic(a) {
  return {
    id: a.id, label: a.label, name: a.name, phone: a.phone,
    city: a.city, addressLine: a.address_line, notes: a.notes || "",
    isDefault: Number(a.is_default) === 1, createdAt: a.created_at
  };
}
app.get("/api/user/addresses", userAuthRequired, async function (req, res) {
  const rows = await db.all(
    "SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, id DESC",
    [req.user.uid]
  );
  res.json(rows.map(toAddrPublic));
});
app.post("/api/user/addresses", userAuthRequired, async function (req, res) {
  const { label, name, phone, city, addressLine, notes, isDefault } = req.body || {};
  if (!name || !phone || !city || !addressLine) {
    return res.status(400).json({ error: "Name, phone, city and address are required." });
  }
  const def = isDefault ? 1 : 0;
  if (def) await db.run("UPDATE addresses SET is_default = 0 WHERE user_id = $1", [req.user.uid]);
  const inserted = await db.run(
    "INSERT INTO addresses (user_id, label, name, phone, city, address_line, notes, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
    [
      req.user.uid, String(label || "Home").trim(), String(name).trim(), normalizePhone(phone),
      String(city).trim(), String(addressLine).trim(), notes ? String(notes).trim() : "", def
    ]
  );
  const row = await db.one("SELECT * FROM addresses WHERE id = $1", [inserted.lastInsertRowid]);
  res.status(201).json(toAddrPublic(row));
});
app.put("/api/user/addresses/:id", userAuthRequired, async function (req, res) {
  const id = Number(req.params.id);
  const row = await db.one("SELECT * FROM addresses WHERE id = $1 AND user_id = $2", [id, req.user.uid]);
  if (!row) return res.status(404).json({ error: "Address not found." });
  const { label, name, phone, city, addressLine, notes, isDefault } = req.body || {};
  if (isDefault) await db.run("UPDATE addresses SET is_default = 0 WHERE user_id = $1", [req.user.uid]);
  await db.run(
    "UPDATE addresses SET label=$1, name=$2, phone=$3, city=$4, address_line=$5, notes=$6, is_default=$7 WHERE id=$8",
    [
      label ? String(label).trim() : row.label,
      name ? String(name).trim() : row.name,
      phone ? normalizePhone(phone) : row.phone,
      city ? String(city).trim() : row.city,
      addressLine ? String(addressLine).trim() : row.address_line,
      notes === undefined ? row.notes : String(notes).trim(),
      isDefault === undefined ? row.is_default : (isDefault ? 1 : 0),
      id
    ]
  );
  const updated = await db.one("SELECT * FROM addresses WHERE id = $1", [id]);
  res.json(toAddrPublic(updated));
});
app.delete("/api/user/addresses/:id", userAuthRequired, async function (req, res) {
  const id = Number(req.params.id);
  const row = await db.one("SELECT * FROM addresses WHERE id = $1 AND user_id = $2", [id, req.user.uid]);
  if (!row) return res.status(404).json({ error: "Address not found." });
  await db.run("DELETE FROM addresses WHERE id = $1", [id]);
  res.json({ ok: true });
});

/* ============================================================
   CONTACT — new
   ============================================================ */
app.post("/api/contact", contactLimiter, async function (req, res) {
  const { name, email: emailVal, phone, subject, message } = req.body || {};
  if (!name || !message) return res.status(400).json({ error: "Name and message are required." });
  if (emailVal && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(emailVal).trim())) {
    return res.status(400).json({ error: "Invalid email." });
  }
  const payload = {
    name: String(name).trim(),
    email: emailVal ? String(emailVal).trim().toLowerCase() : "",
    phone: phone ? normalizePhone(phone) : "",
    subject: subject ? String(subject).trim() : "",
    message: String(message).trim()
  };
  await db.run(
    "INSERT INTO contact_messages (name, email, phone, subject, message) VALUES ($1,$2,$3,$4,$5)",
    [payload.name, payload.email || null, payload.phone || null, payload.subject, payload.message]
  );
  // fire-and-forget email
  email.sendContactFormToShop(payload).catch(e => console.error("[contact email]", e));
  res.status(201).json({ ok: true });
});

/* ---------- safe error handler ---------- */
app.use(function (err, req, res, next) {
  const msg = String(err && err.message || "");
  const isSafe = /only|allowed|too large|file size|invalid file|origin not allowed/i.test(msg);
  if (!isSafe) console.error("[error]", req.method, req.path, err);
  res.status(400).json({ error: isSafe ? msg : "Bad request." });
});

/* ---------- start listener only when run directly (local dev) ---------- */
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  // Serve static site locally (Vercel handles static files in production).
  app.use(express.static(__dirname, { dotfiles: "deny" }));
  app.listen(PORT, function () {
    console.log("Amir Hardware API running at http://localhost:" + PORT);
    console.log("Admin dashboard:   http://localhost:" + PORT + "/admin.html");
    console.log("Main site:         http://localhost:" + PORT + "/");
  });
}

module.exports = app;
