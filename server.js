/* ============================================================
   AMIR HARDWARE — Backend Server
   Express + SQLite (node:sqlite) + JWT Admin Auth + Multer Uploads
   ============================================================ */

const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const PORT = process.env.PORT || 5000;
const crypto = require("crypto");
function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const secretFile = path.join(__dirname, ".jwt-secret");
  try {
    const existing = fs.readFileSync(secretFile, "utf8").trim();
    if (existing) return existing;
  } catch (e) { /* not created yet */ }
  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}
const JWT_SECRET = loadJwtSecret();
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DB_FILE = path.join(__dirname, "store.db");

/* ---------- embedded SQLite database ---------- */
const db = new DatabaseSync(DB_FILE);

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'Admin',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'General',
    brand TEXT NOT NULL DEFAULT 'Amir Hardware',
    price REAL NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    image TEXT,
    in_stock INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT NOT NULL UNIQUE,
    email TEXT,
    name TEXT NOT NULL,
    password TEXT NOT NULL,
    city TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    order_code TEXT NOT NULL UNIQUE,
    subtotal REAL NOT NULL DEFAULT 0,
    delivery_fee REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'COD',
    payment_status TEXT NOT NULL DEFAULT 'pending',
    status TEXT NOT NULL DEFAULT 'placed',
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    address_line TEXT NOT NULL,
    city TEXT NOT NULL,
    notes TEXT DEFAULT '',
    delivery_date TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    brand TEXT DEFAULT '',
    price REAL NOT NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    image TEXT,
    FOREIGN KEY(order_id) REFERENCES orders(id)
  );

  CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

  CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    image TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    title TEXT DEFAULT '',
    body TEXT DEFAULT '',
    verified_purchase INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_pimg_product ON product_images(product_id);
  CREATE INDEX IF NOT EXISTS idx_rev_product ON reviews(product_id);
  CREATE INDEX IF NOT EXISTS idx_rev_user_product ON reviews(user_id, product_id);

  CREATE TABLE IF NOT EXISTS addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    label TEXT NOT NULL DEFAULT 'Home',
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    city TEXT NOT NULL,
    address_line TEXT NOT NULL,
    notes TEXT DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_addr_user ON addresses(user_id);

  CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    label TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'percent',
    value REAL NOT NULL DEFAULT 0,
    min_subtotal REAL NOT NULL DEFAULT 0,
    max_discount REAL NOT NULL DEFAULT 0,
    usage_limit INTEGER NOT NULL DEFAULT 0,
    used_count INTEGER NOT NULL DEFAULT 0,
    starts_at TEXT DEFAULT '',
    expires_at TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS coupon_uses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coupon_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    order_id INTEGER NOT NULL,
    applied_amount REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS point_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    order_id INTEGER,
    points INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'earn',
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS newsletter_subs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    phone TEXT DEFAULT '',
    user_id INTEGER,
    source TEXT DEFAULT 'footer',
    subscribed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_coup_code ON coupons(code);
  CREATE INDEX IF NOT EXISTS idx_pt_user ON point_transactions(user_id);
`);

/* ---------- schema upgrade: flash sale + loyalty + contractor columns ---------- */
try { db.exec("ALTER TABLE products ADD COLUMN flash_discount_pct INTEGER NOT NULL DEFAULT 0"); console.log("[schema] flash_discount_pct added"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN is_deal_of_day INTEGER NOT NULL DEFAULT 0"); console.log("[schema] is_deal_of_day added"); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN loyalty_points INTEGER NOT NULL DEFAULT 0"); console.log("[schema] loyalty_points added"); } catch (e) {}
try { db.exec("ALTER TABLE users ADD COLUMN is_contractor INTEGER NOT NULL DEFAULT 0"); console.log("[schema] is_contractor added"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN coupon_code TEXT DEFAULT ''"); console.log("[schema] coupon_code added"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0"); console.log("[schema] discount_amount added"); } catch (e) {}
try { db.exec("ALTER TABLE orders ADD COLUMN points_earned INTEGER NOT NULL DEFAULT 0"); console.log("[schema] points_earned added"); } catch (e) {}

/* ---------- seed sample coupons ---------- */
const SEED_COUPONS = [
  { code: "FIRST10", label: "First order 10% off", type: "percent", value: 10, min_subtotal: 1000, max_discount: 500, usage_limit: 0 },
  { code: "BULK500", label: "Rs 500 off on 5000+", type: "fixed", value: 500, min_subtotal: 5000, max_discount: 500, usage_limit: 0 },
  { code: "WELCOME100", label: "Rs 100 off new customers", type: "fixed", value: 100, min_subtotal: 800, max_discount: 100, usage_limit: 0 },
  { code: "CONTRACTOR15", label: "Contractor 15% off bulk", type: "percent", value: 15, min_subtotal: 10000, max_discount: 2500, usage_limit: 0 }
];
for (const c of SEED_COUPONS) {
  const existing = db.prepare("SELECT id FROM coupons WHERE code = ?").get(c.code);
  if (!existing) {
    db.prepare("INSERT INTO coupons (code, label, type, value, min_subtotal, max_discount, usage_limit) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      c.code, c.label, c.type, c.value, c.min_subtotal, c.max_discount, c.usage_limit
    );
  }
}

/* ---------- schema upgrade: courier/tracking columns on orders ---------- */
try { db.exec("ALTER TABLE orders ADD COLUMN courier TEXT DEFAULT ''"); console.log("[schema] courier column added"); } catch (e) { /* exists */ }
try { db.exec("ALTER TABLE orders ADD COLUMN tracking_number TEXT DEFAULT ''"); console.log("[schema] tracking_number column added"); } catch (e) { /* exists */ }
try { db.exec("ALTER TABLE orders ADD COLUMN delivery_slot TEXT DEFAULT ''"); console.log("[schema] delivery_slot column added"); } catch (e) { /* exists */ }
try { db.exec("ALTER TABLE orders ADD COLUMN estimated_delivery TEXT DEFAULT ''"); console.log("[schema] estimated_delivery column added"); } catch (e) { /* exists */ }

/* ---------- schema upgrade: stock_qty on products ---------- */
try {
  db.exec("ALTER TABLE products ADD COLUMN stock_qty INTEGER NOT NULL DEFAULT 10");
  console.log("[schema] stock_qty column added");
} catch (e) { /* already exists */ }

/* ---------- schema upgrade: ensure brand column ---------- */
try {
  db.exec("ALTER TABLE products ADD COLUMN brand TEXT NOT NULL DEFAULT 'Amir Hardware'");
  console.log("[schema] brand column added");
} catch (e) { /* already exists */ }

/* ---------- seed default products (from old website array) ---------- */
const SEED_PRODUCTS = [
  {title:"Greenply Plywood 18mm", category:"Plywood", brand:"Greenply", price:4500, img:"uploads/piro4d-plywood-1536897_1920.jpg", desc:"Premium 18mm commercial plywood"},
  {title:"Merino Teak Wood Sheet", category:"Plywood", brand:"Merino", price:6500, img:"uploads/nytimber-timber-843056_1920.jpg", desc:"Premium teak wood panel for furniture"},
  {title:"Master Paints Super Gloss 5L", category:"Paint", brand:"Master", price:2800, img:"uploads/publicdomainpictures-construction-19696_1920.jpg", desc:"Premium gloss finish paint"},
  {title:"Chrome Kitchen Faucet", category:"Sanitary", brand:"Stanley", price:3800, img:"uploads/10901427-faucet-3857471_1920.jpg", desc:"Single-lever chrome kitchen tap"},
  {title:"Modern Bathroom Suite", category:"Sanitary", brand:"Stanley", price:45000, img:"uploads/myjanitors-bathroom-453420_1920.png", desc:"Complete bathroom fitting set"},
  {title:"CPVC Pipe Fittings Set", category:"Plumbing", brand:"Stanley", price:1500, img:"uploads/mikecastelan-tubes-5979674.jpg", desc:"CPVC pipes and connectors"},
  {title:"Bosch Power Drill Machine", category:"Hardware", brand:"Bosch", price:12500, img:"uploads/openclipart-vectors-power-drill-154903_1920.png", desc:"Professional 800W drill machine"},
  {title:"Stanley Wrench Set 20pc", category:"Hardware", brand:"Stanley", price:3500, img:"uploads/l-hao-tools-2200627_1920.jpg", desc:"Chrome vanadium wrench set"},
  {title:"Greenply Plywood 12mm", category:"Plywood", brand:"Greenply", price:3200, img:"uploads/WhatsApp%20Image%202026-08-12%20at%2012.17.20%20AM.jpeg", desc:"Standard 12mm plywood sheet"},
  {title:"Ceramic Wash Basin", category:"Sanitary", brand:"Stanley", price:8500, img:"uploads/WhatsApp%20Image%202026-08-12%20at%2012.17.21%20AM%20(1).jpeg", desc:"Wall-mounted ceramic basin"},
];
for (const sp of SEED_PRODUCTS) {
  const already = db.prepare("SELECT id FROM products WHERE title = ?").get(sp.title);
  if (!already) {
    db.prepare("INSERT INTO products (title, category, brand, price, description, image) VALUES (?, ?, ?, ?, ?, ?)")
      .run(sp.title, sp.category, sp.brand, sp.price, sp.desc, sp.img.replace(/^uploads\//, ""));
  }
}
if (process.env.NODE_ENV !== "test") console.log("[seed] ensured default products");

/* ---------- seed default admin account ---------- */
const DEFAULT_ADMIN = {
  email: process.env.ADMIN_EMAIL || "admin@amirhardware.com",
  password: process.env.ADMIN_PASSWORD || "admin123"
};

const existing = db.prepare("SELECT id FROM admins WHERE email = ?").get(DEFAULT_ADMIN.email);
if (!existing) {
  const hash = bcrypt.hashSync(DEFAULT_ADMIN.password, 10);
  db.prepare("INSERT INTO admins (email, password, name) VALUES (?, ?, ?)").run(
    DEFAULT_ADMIN.email,
    hash,
    "Amir Hardware Admin"
  );
  console.log("[setup] Default admin created — email: " + DEFAULT_ADMIN.email + " / password: " + DEFAULT_ADMIN.password);
}

/* ---------- uploads + static dirs ---------- */
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(function (req, res, next) {
  if (/^\/(?:store\.db|.*\.db|server\.js|package(?:-lock)?\.json|\.env|\.jwt-secret|node_modules)(?:\/|$)/i.test(req.path)) {
    return res.status(404).end();
  }
  next();
});
app.use(express.static(__dirname, { dotfiles: "deny" }));

/* ---------- multer image upload ---------- */
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "product-" + unique + ext);
  }
});

const fileFilter = function (req, file, cb) {
  if (/^image\//.test(file.mimetype)) cb(null, true);
  else cb(new Error("Only image files are allowed."), false);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

/* ---------- JWT helpers ---------- */
function signToken(admin) {
  return jwt.sign({ id: admin.id, email: admin.email, name: admin.name }, JWT_SECRET, { expiresIn: "7d" });
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token. Please log in." });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired token. Please log in again." });
  }
}

/* ---------- helpers ---------- */
function toPublic(p) {
  // Fetch gallery images (if product_images table has rows for this id)
  let gallery = [];
  try {
    const imgRows = db.prepare("SELECT image FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC").all(p.id);
    gallery = imgRows.map(function (r) {
      return r.image.indexOf("http") === 0 ? r.image : "/uploads/" + r.image.replace(/^\/?uploads\//i, "");
    });
  } catch (e) { /* table may not exist on first run */ }

  // Aggregate rating
  let ratingAgg = { avg: 0, count: 0 };
  try {
    const row = db.prepare("SELECT ROUND(AVG(rating), 1) as avg, COUNT(*) as cnt FROM reviews WHERE product_id = ?").get(p.id);
    if (row && row.cnt) { ratingAgg.avg = Number(row.avg) || 0; ratingAgg.count = row.cnt; }
  } catch (e) { /* ignore */ }

  const mainImg = p.image ? "/uploads/" + p.image : null;
  // Full images list: main image first, then gallery (dedupe)
  const images = [];
  if (mainImg) images.push(mainImg);
  gallery.forEach(function (g) { if (images.indexOf(g) < 0) images.push(g); });

  return {
    id: p.id,
    title: p.title,
    category: p.category,
    brand: p.brand || "",
    price: p.price,
    description: p.description,
    image: mainImg,
    images: images,
    inStock: p.in_stock === 1,
    stockQty: p.stock_qty === undefined ? null : Number(p.stock_qty),
    rating: ratingAgg.avg,
    reviewCount: ratingAgg.count,
    flashDiscountPct: Number(p.flash_discount_pct) || 0,
    isDealOfDay: p.is_deal_of_day === 1,
    createdAt: p.created_at
  };
}

/* ============================================================
   AUTH
   ============================================================ */
app.post("/api/auth/login", function (req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  const admin = db.prepare("SELECT * FROM admins WHERE email = ?").get(String(email).toLowerCase().trim());
  if (!admin || !bcrypt.compareSync(String(password), admin.password)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }
  res.json({ token: signToken(admin), admin: { id: admin.id, name: admin.name, email: admin.email } });
});

/* ============================================================
   PRODUCTS — public
   ============================================================ */
app.get("/api/products", function (req, res) {
  const rows = db.prepare("SELECT * FROM products ORDER BY created_at DESC, id DESC").all();
  res.json(rows.map(toPublic));
});

/* ============================================================
   PRODUCTS — protected (admin)
   ============================================================ */
app.post("/api/products", authRequired, upload.single("image"), function (req, res) {
  const { title, category, brand, price, description, in_stock } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: "Title is required." });

  const result = db
    .prepare("INSERT INTO products (title, category, brand, price, description, image, in_stock) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(
      title.trim(),
      (category || "General").trim(),
      (brand || "").trim(),
      Number(price) || 0,
      (description || "").trim(),
      req.file ? req.file.filename : null,
      in_stock === undefined ? 1 : Number(in_stock)
    );

  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(toPublic(row));
});

app.put("/api/products/:id", authRequired, upload.single("image"), function (req, res) {
  const id = Number(req.params.id);
  const existingRow = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!existingRow) return res.status(404).json({ error: "Product not found." });

  const { title, category, brand, price, description, in_stock } = req.body;
  const inStock = in_stock === undefined ? existingRow.in_stock : Number(in_stock);

  let image = existingRow.image;
  if (req.file) {
    image = req.file.filename;
    if (existingRow.image) {
      try { fs.unlinkSync(path.join(UPLOAD_DIR, existingRow.image)); } catch (e) { /* ignore */ }
    }
  }

  db.prepare(
    "UPDATE products SET title = ?, category = ?, brand = ?, price = ?, description = ?, image = ?, in_stock = ? WHERE id = ?"
  ).run(
    title && title.trim() ? title.trim() : existingRow.title,
    (category || existingRow.category).trim(),
    brand && brand.trim() ? brand.trim() : (existingRow.brand || existingRow.category),
    price === undefined || price === "" ? existingRow.price : Number(price),
    description === undefined ? existingRow.description : String(description).trim(),
    image,
    inStock,
    id
  );

  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  res.json(toPublic(row));
});

app.delete("/api/products/:id", authRequired, function (req, res) {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Product not found." });

  if (row.image) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, row.image)); } catch (e) { /* ignore */ }
  }
  db.prepare("DELETE FROM products WHERE id = ?").run(id);
  res.json({ ok: true, message: "Product deleted." });
});

/* ============================================================
   USER AUTH (customers)
   ============================================================ */
function signUserToken(user) {
  return jwt.sign({ uid: user.id, phone: user.phone, name: user.name, kind: "user" }, JWT_SECRET, { expiresIn: "30d" });
}
function userAuthRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Login required." });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.kind !== "user") return res.status(401).json({ error: "Not a user token." });
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Session expired. Please log in again." });
  }
}
function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (!digits) return "";
  // Pakistani format: convert 03xx to 923xx, keep 92... as-is, or add 92 to leading 3
  if (digits.startsWith("92")) return digits;
  if (digits.startsWith("03")) return "92" + digits.slice(1);
  if (digits.startsWith("3") && digits.length === 10) return "92" + digits;
  return digits;
}

app.post("/api/user/register", function (req, res) {
  const { name, phone, email, password, city } = req.body || {};
  if (!name || !phone || !password) return res.status(400).json({ error: "Name, phone and password are required." });
  if (String(password).length < 4) return res.status(400).json({ error: "Password must be at least 4 characters." });
  const normPhone = normalizePhone(phone);
  if (!normPhone || normPhone.length < 10) return res.status(400).json({ error: "Please enter a valid phone number." });
  const existing = db.prepare("SELECT id FROM users WHERE phone = ?").get(normPhone);
  if (existing) return res.status(409).json({ error: "This phone number is already registered. Please log in." });
  const hash = bcrypt.hashSync(String(password), 10);
  const result = db.prepare("INSERT INTO users (phone, email, name, password, city) VALUES (?, ?, ?, ?, ?)").run(
    normPhone,
    email ? String(email).trim().toLowerCase() : null,
    String(name).trim(),
    hash,
    city ? String(city).trim() : ""
  );
  const user = db.prepare("SELECT id, name, phone, email, city FROM users WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json({ token: signUserToken(user), user });
});

app.post("/api/user/login", function (req, res) {
  const { phone, password } = req.body || {};
  if (!phone || !password) return res.status(400).json({ error: "Phone and password are required." });
  const normPhone = normalizePhone(phone);
  const user = db.prepare("SELECT * FROM users WHERE phone = ?").get(normPhone);
  if (!user || !bcrypt.compareSync(String(password), user.password)) {
    return res.status(401).json({ error: "Invalid phone or password." });
  }
  res.json({ token: signUserToken(user), user: { id: user.id, name: user.name, phone: user.phone, email: user.email, city: user.city } });
});

app.get("/api/user/me", userAuthRequired, function (req, res) {
  const user = db.prepare("SELECT id, name, phone, email, city FROM users WHERE id = ?").get(req.user.uid);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user });
});

/* ============================================================
   ORDERS
   ============================================================ */
function toOrderPublic(order, items) {
  return {
    id: order.id,
    orderCode: order.order_code,
    subtotal: order.subtotal,
    deliveryFee: order.delivery_fee,
    total: order.total,
    paymentMethod: order.payment_method,
    paymentStatus: order.payment_status,
    status: order.status,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    addressLine: order.address_line,
    city: order.city,
    notes: order.notes,
    deliveryDate: order.delivery_date,
    courier: order.courier || "",
    trackingNumber: order.tracking_number || "",
    deliverySlot: order.delivery_slot || "",
    estimatedDelivery: order.estimated_delivery || "",
    couponCode: order.coupon_code || "",
    discountAmount: Number(order.discount_amount) || 0,
    pointsEarned: Number(order.points_earned) || 0,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: (items || []).map(function (it) {
      return {
        id: it.id,
        productId: it.product_id,
        title: it.title,
        brand: it.brand,
        price: it.price,
        qty: it.qty,
        image: it.image ? (it.image.indexOf("http") === 0 ? it.image : "/uploads/" + it.image.replace(/^\/?uploads\//i, "")) : null
      };
    })
  };
}

function generateOrderCode() {
  const t = Date.now().toString(36).toUpperCase();
  const r = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return "AH-" + t.slice(-5) + "-" + r;
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

// Public: price-check cart without placing order
app.post("/api/orders/preview", function (req, res) {
  const { items, city } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "Cart is empty." });
  const resolved = [];
  let subtotal = 0;
  for (const it of items) {
    const p = db.prepare("SELECT * FROM products WHERE id = ?").get(Number(it.id));
    if (!p) continue;
    const qty = Math.max(1, Number(it.qty) || 1);
    const line = p.price * qty;
    subtotal += line;
    resolved.push({ productId: p.id, title: p.title, brand: p.brand, price: p.price, qty: qty, image: p.image });
  }
  const fee = deliveryFeeForCity(city);
  res.json({ subtotal: subtotal, deliveryFee: fee, total: subtotal + fee, items: resolved });
});

// Helper: validate and compute coupon discount
function computeCouponDiscount(coupon, subtotal) {
  if (!coupon || coupon.active === 0) return { discount: 0, error: "Invalid or expired coupon." };
  if (coupon.min_subtotal && subtotal < coupon.min_subtotal) {
    return { discount: 0, error: "Minimum order Rs " + coupon.min_subtotal + " required." };
  }
  if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
    return { discount: 0, error: "This coupon has reached its usage limit." };
  }
  if (coupon.expires_at) {
    const exp = new Date(coupon.expires_at);
    if (!isNaN(exp) && exp < new Date()) return { discount: 0, error: "This coupon has expired." };
  }
  let discount = coupon.type === "percent" ? Math.round(subtotal * coupon.value / 100) : Number(coupon.value);
  if (coupon.max_discount > 0) discount = Math.min(discount, coupon.max_discount);
  return { discount: Math.max(0, discount), error: null };
}

// Place order (requires login)
app.post("/api/orders", userAuthRequired, function (req, res) {
  const { items, customerName, customerPhone, addressLine, city, notes, deliveryDate, paymentMethod, couponCode } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: "Cart is empty." });
  if (!customerName || !customerPhone || !addressLine || !city) {
    return res.status(400).json({ error: "Name, phone, address and city are required." });
  }
  const method = ["COD", "BANK_TRANSFER", "JAZZCASH", "EASYPAISA", "CARD"].indexOf(paymentMethod) >= 0 ? paymentMethod : "COD";

  const resolved = [];
  let subtotal = 0;
  for (const it of items) {
    const p = db.prepare("SELECT * FROM products WHERE id = ?").get(Number(it.id));
    if (!p) return res.status(400).json({ error: "Product " + it.id + " not found." });
    if (p.in_stock === 0) return res.status(400).json({ error: "\"" + p.title + "\" is out of stock." });
    const qty = Math.max(1, Number(it.qty) || 1);
    // Apply flash discount if set on product
    const unitPrice = p.flash_discount_pct > 0 ? Math.round(p.price * (100 - p.flash_discount_pct) / 100) : p.price;
    const line = unitPrice * qty;
    subtotal += line;
    resolved.push({ product_id: p.id, title: p.title, brand: p.brand || "", price: unitPrice, qty: qty, image: p.image });
  }

  // Coupon validation
  let discountAmount = 0;
  let appliedCoupon = null;
  if (couponCode) {
    const coupon = db.prepare("SELECT * FROM coupons WHERE code = ?").get(String(couponCode).trim().toUpperCase());
    if (!coupon) return res.status(400).json({ error: "Invalid coupon code." });
    const check = computeCouponDiscount(coupon, subtotal);
    if (check.error) return res.status(400).json({ error: check.error });
    discountAmount = check.discount;
    appliedCoupon = coupon;
  }

  // Contractor tier: additional 5% off for verified contractors (on subtotal, before delivery)
  const user = db.prepare("SELECT is_contractor FROM users WHERE id = ?").get(req.user.uid);
  if (user && user.is_contractor === 1 && subtotal > 0) {
    const contractorDiscount = Math.round(subtotal * 0.05);
    discountAmount += contractorDiscount;
  }

  const deliveryFee = deliveryFeeForCity(city);
  const total = Math.max(0, subtotal - discountAmount + deliveryFee);
  const orderCode = generateOrderCode();
  // Loyalty: 1 point per Rs 100 spent (rounded down)
  const pointsEarned = Math.floor(total / 100);

  const tx = db.prepare(
    "INSERT INTO orders (user_id, order_code, subtotal, delivery_fee, total, payment_method, payment_status, status, customer_name, customer_phone, address_line, city, notes, delivery_date, coupon_code, discount_amount, points_earned) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    req.user.uid, orderCode, subtotal, deliveryFee, total, method,
    method === "COD" ? "cod_pending" : "awaiting_payment", "placed",
    String(customerName).trim(), normalizePhone(customerPhone),
    String(addressLine).trim(), String(city).trim(),
    notes ? String(notes).trim() : "",
    deliveryDate ? String(deliveryDate).trim() : "",
    appliedCoupon ? appliedCoupon.code : "",
    discountAmount, pointsEarned
  );
  const orderId = tx.lastInsertRowid;
  const insertItem = db.prepare("INSERT INTO order_items (order_id, product_id, title, brand, price, qty, image) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const it of resolved) insertItem.run(orderId, it.product_id, it.title, it.brand, it.price, it.qty, it.image);

  // Record coupon use + award points
  if (appliedCoupon) {
    db.prepare("INSERT INTO coupon_uses (coupon_id, user_id, order_id, applied_amount) VALUES (?, ?, ?, ?)").run(appliedCoupon.id, req.user.uid, orderId, discountAmount);
    db.prepare("UPDATE coupons SET used_count = used_count + 1 WHERE id = ?").run(appliedCoupon.id);
  }
  if (pointsEarned > 0) {
    db.prepare("INSERT INTO point_transactions (user_id, order_id, points, type, description) VALUES (?, ?, ?, 'earn', ?)")
      .run(req.user.uid, orderId, pointsEarned, "Order " + orderCode);
    db.prepare("UPDATE users SET loyalty_points = loyalty_points + ? WHERE id = ?").run(pointsEarned, req.user.uid);
  }

  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  const orderItems = db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").all(orderId);
  res.status(201).json(toOrderPublic(order, orderItems));
});

/* ============================================================
   COUPONS
   ============================================================ */
// Public: validate a coupon against a cart subtotal
app.post("/api/coupons/validate", function (req, res) {
  const { code, subtotal } = req.body || {};
  if (!code) return res.status(400).json({ valid: false, error: "Coupon code required." });
  const coupon = db.prepare("SELECT * FROM coupons WHERE code = ?").get(String(code).trim().toUpperCase());
  if (!coupon) return res.status(404).json({ valid: false, error: "Invalid coupon code." });
  const check = computeCouponDiscount(coupon, Number(subtotal) || 0);
  if (check.error) return res.status(400).json({ valid: false, error: check.error });
  res.json({
    valid: true,
    code: coupon.code,
    label: coupon.label,
    type: coupon.type,
    value: coupon.value,
    discount: check.discount
  });
});

// Public: list visible active coupons (to show in cart "available coupons")
app.get("/api/coupons/public", function (req, res) {
  const rows = db.prepare(
    "SELECT code, label, type, value, min_subtotal, max_discount, expires_at FROM coupons WHERE active = 1 ORDER BY id DESC LIMIT 10"
  ).all();
  res.json(rows);
});

// Admin: list all
app.get("/api/admin/coupons", authRequired, function (req, res) {
  const rows = db.prepare("SELECT * FROM coupons ORDER BY id DESC").all();
  res.json(rows);
});

app.post("/api/admin/coupons", authRequired, function (req, res) {
  const { code, label, type, value, min_subtotal, max_discount, usage_limit, starts_at, expires_at, active } = req.body || {};
  if (!code || !type || value === undefined) return res.status(400).json({ error: "Code, type and value required." });
  const codeNorm = String(code).trim().toUpperCase();
  const existing = db.prepare("SELECT id FROM coupons WHERE code = ?").get(codeNorm);
  if (existing) return res.status(409).json({ error: "Coupon code already exists." });
  const result = db.prepare(
    "INSERT INTO coupons (code, label, type, value, min_subtotal, max_discount, usage_limit, starts_at, expires_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    codeNorm, String(label || "").trim(), type === "fixed" ? "fixed" : "percent",
    Number(value) || 0, Number(min_subtotal) || 0, Number(max_discount) || 0,
    Number(usage_limit) || 0, String(starts_at || "").trim(), String(expires_at || "").trim(),
    active === false ? 0 : 1
  );
  const row = db.prepare("SELECT * FROM coupons WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(row);
});

app.put("/api/admin/coupons/:id", authRequired, function (req, res) {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM coupons WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Coupon not found." });
  const { label, type, value, min_subtotal, max_discount, usage_limit, starts_at, expires_at, active } = req.body || {};
  db.prepare(
    "UPDATE coupons SET label = ?, type = ?, value = ?, min_subtotal = ?, max_discount = ?, usage_limit = ?, starts_at = ?, expires_at = ?, active = ? WHERE id = ?"
  ).run(
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
  );
  const updated = db.prepare("SELECT * FROM coupons WHERE id = ?").get(id);
  res.json(updated);
});

app.delete("/api/admin/coupons/:id", authRequired, function (req, res) {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM coupons WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Coupon not found." });
  db.prepare("DELETE FROM coupons WHERE id = ?").run(id);
  res.json({ ok: true });
});

/* ============================================================
   LOYALTY POINTS
   ============================================================ */
app.get("/api/user/points", userAuthRequired, function (req, res) {
  const user = db.prepare("SELECT loyalty_points FROM users WHERE id = ?").get(req.user.uid);
  const txs = db.prepare("SELECT * FROM point_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(req.user.uid);
  res.json({
    balance: (user && user.loyalty_points) || 0,
    rupeeValue: Math.floor(((user && user.loyalty_points) || 0) / 10), // 10 pts = Rs 1
    transactions: txs.map(function (t) {
      return { id: t.id, points: t.points, type: t.type, description: t.description, createdAt: t.created_at };
    })
  });
});

/* ============================================================
   NEWSLETTER
   ============================================================ */
app.post("/api/newsletter/subscribe", function (req, res) {
  const { email, phone, source } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email required." });
  const emailNorm = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailNorm)) return res.status(400).json({ error: "Please enter a valid email." });
  const existing = db.prepare("SELECT id FROM newsletter_subs WHERE email = ?").get(emailNorm);
  if (existing) return res.json({ ok: true, alreadySubscribed: true });
  db.prepare("INSERT INTO newsletter_subs (email, phone, source) VALUES (?, ?, ?)").run(
    emailNorm, phone ? normalizePhone(phone) : "", String(source || "footer").trim()
  );
  res.status(201).json({ ok: true });
});

app.get("/api/admin/newsletter", authRequired, function (req, res) {
  const rows = db.prepare("SELECT * FROM newsletter_subs ORDER BY id DESC LIMIT 1000").all();
  res.json(rows);
});

/* ============================================================
   FLASH SALE (admin toggle)
   ============================================================ */
app.patch("/api/products/:id/flash", authRequired, function (req, res) {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Product not found." });
  const { flashDiscountPct, isDealOfDay } = req.body || {};
  db.prepare("UPDATE products SET flash_discount_pct = ?, is_deal_of_day = ? WHERE id = ?").run(
    flashDiscountPct === undefined ? row.flash_discount_pct : Math.max(0, Math.min(90, Number(flashDiscountPct))),
    isDealOfDay === undefined ? row.is_deal_of_day : (isDealOfDay ? 1 : 0),
    id
  );
  const updated = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  res.json(toPublic(updated));
});

// Get my orders (user)
app.get("/api/orders/mine", userAuthRequired, function (req, res) {
  const orders = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC").all(req.user.uid);
  const result = orders.map(function (o) {
    const items = db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").all(o.id);
    return toOrderPublic(o, items);
  });
  res.json(result);
});

// Get single order (user — own only, or admin — any)
app.get("/api/orders/:id", function (req, res) {
  const id = Number(req.params.id);
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!order) return res.status(404).json({ error: "Order not found." });

  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  let allowed = false;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.kind === "user" && decoded.uid === order.user_id) allowed = true;
      if (decoded.kind !== "user" && decoded.id) allowed = true; // admin
    } catch (e) { /* ignore */ }
  }
  if (!allowed) return res.status(403).json({ error: "You cannot view this order." });

  const items = db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").all(id);
  res.json(toOrderPublic(order, items));
});

// Admin: list all orders
app.get("/api/admin/orders", authRequired, function (req, res) {
  const orders = db.prepare(
    "SELECT o.*, u.name as _user_name, u.phone as _user_phone FROM orders o LEFT JOIN users u ON u.id = o.user_id ORDER BY o.id DESC"
  ).all();
  const result = orders.map(function (o) {
    const items = db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").all(o.id);
    const base = toOrderPublic(o, items);
    base.userName = o._user_name;
    base.userPhone = o._user_phone;
    return base;
  });
  res.json(result);
});

// Admin: update order status
app.put("/api/admin/orders/:id/status", authRequired, function (req, res) {
  const id = Number(req.params.id);
  const { status, paymentStatus } = req.body || {};
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Order not found." });
  const validStatus = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled"];
  const validPayment = ["cod_pending", "awaiting_payment", "paid", "failed", "refunded"];
  const newStatus = validStatus.indexOf(status) >= 0 ? status : row.status;
  const newPaymentStatus = validPayment.indexOf(paymentStatus) >= 0 ? paymentStatus : row.payment_status;
  db.prepare("UPDATE orders SET status = ?, payment_status = ?, updated_at = datetime('now') WHERE id = ?").run(newStatus, newPaymentStatus, id);
  const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  const items = db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").all(id);
  res.json(toOrderPublic(updated, items));
});

/* ============================================================
   PRODUCT GALLERY IMAGES (admin)
   ============================================================ */
// Upload one gallery image (multipart "image")
app.post("/api/products/:id/images", authRequired, upload.single("image"), function (req, res) {
  const id = Number(req.params.id);
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!product) return res.status(404).json({ error: "Product not found." });
  if (!req.file) return res.status(400).json({ error: "Image file required." });
  const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) as m FROM product_images WHERE product_id = ?").get(id);
  const result = db.prepare("INSERT INTO product_images (product_id, image, sort_order) VALUES (?, ?, ?)")
    .run(id, req.file.filename, (maxOrder.m || 0) + 1);
  res.status(201).json({ ok: true, id: result.lastInsertRowid, image: "/uploads/" + req.file.filename });
});

// Delete one gallery image
app.delete("/api/products/:id/images/:imgId", authRequired, function (req, res) {
  const id = Number(req.params.id);
  const imgId = Number(req.params.imgId);
  const row = db.prepare("SELECT * FROM product_images WHERE id = ? AND product_id = ?").get(imgId, id);
  if (!row) return res.status(404).json({ error: "Image not found." });
  try { fs.unlinkSync(path.join(UPLOAD_DIR, row.image)); } catch (e) { /* ignore */ }
  db.prepare("DELETE FROM product_images WHERE id = ?").run(imgId);
  res.json({ ok: true });
});

// Admin: update stock quantity
app.patch("/api/products/:id/stock", authRequired, function (req, res) {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Product not found." });
  const { stockQty, inStock } = req.body || {};
  const qty = stockQty === undefined ? row.stock_qty : Math.max(0, Number(stockQty));
  const flag = inStock === undefined ? (qty > 0 ? 1 : 0) : (Number(inStock) ? 1 : 0);
  db.prepare("UPDATE products SET stock_qty = ?, in_stock = ? WHERE id = ?").run(qty, flag, id);
  const updated = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  res.json(toPublic(updated));
});

/* ============================================================
   REVIEWS
   ============================================================ */
app.get("/api/reviews", function (req, res) {
  const productId = Number(req.query.productId);
  if (!productId) return res.status(400).json({ error: "productId is required." });
  const rows = db.prepare(
    "SELECT r.*, u.name as user_name FROM reviews r LEFT JOIN users u ON u.id = r.user_id WHERE r.product_id = ? ORDER BY r.id DESC LIMIT 50"
  ).all(productId);
  const summary = db.prepare("SELECT ROUND(AVG(rating), 1) as avg, COUNT(*) as cnt FROM reviews WHERE product_id = ?").get(productId);
  const dist = [0, 0, 0, 0, 0];
  const distRows = db.prepare("SELECT rating, COUNT(*) as c FROM reviews WHERE product_id = ? GROUP BY rating").all(productId);
  distRows.forEach(function (r) { if (r.rating >= 1 && r.rating <= 5) dist[r.rating - 1] = r.c; });
  res.json({
    average: Number(summary && summary.avg) || 0,
    count: (summary && summary.cnt) || 0,
    distribution: dist,
    reviews: rows.map(function (r) {
      return {
        id: r.id,
        userName: r.user_name || "Customer",
        rating: r.rating,
        title: r.title,
        body: r.body,
        verifiedPurchase: r.verified_purchase === 1,
        createdAt: r.created_at
      };
    })
  });
});

app.post("/api/reviews", userAuthRequired, function (req, res) {
  const { productId, rating, title, body } = req.body || {};
  const pid = Number(productId);
  const r = Math.max(1, Math.min(5, Number(rating) || 0));
  if (!pid || !r) return res.status(400).json({ error: "productId and rating (1-5) are required." });
  const prod = db.prepare("SELECT id FROM products WHERE id = ?").get(pid);
  if (!prod) return res.status(404).json({ error: "Product not found." });
  // Check verified purchase
  const bought = db.prepare(
    "SELECT COUNT(*) as c FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.user_id = ? AND oi.product_id = ? AND o.status != 'cancelled'"
  ).get(req.user.uid, pid);
  const verified = bought && bought.c > 0 ? 1 : 0;
  // One review per user per product: upsert
  const existing = db.prepare("SELECT id FROM reviews WHERE user_id = ? AND product_id = ?").get(req.user.uid, pid);
  if (existing) {
    db.prepare("UPDATE reviews SET rating = ?, title = ?, body = ?, verified_purchase = ?, created_at = datetime('now') WHERE id = ?")
      .run(r, String(title || "").trim(), String(body || "").trim(), verified, existing.id);
    const row = db.prepare("SELECT * FROM reviews WHERE id = ?").get(existing.id);
    return res.json({ ok: true, review: row, updated: true });
  }
  const result = db.prepare("INSERT INTO reviews (product_id, user_id, rating, title, body, verified_purchase) VALUES (?, ?, ?, ?, ?, ?)")
    .run(pid, req.user.uid, r, String(title || "").trim(), String(body || "").trim(), verified);
  const row = db.prepare("SELECT * FROM reviews WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json({ ok: true, review: row });
});

/* ============================================================
   RELATED PRODUCTS
   ============================================================ */
app.get("/api/products/:id/related", function (req, res) {
  const id = Number(req.params.id);
  const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!product) return res.status(404).json({ error: "Product not found." });
  // Prefer same brand+category, then same category, then anything else
  const sameBoth = db.prepare("SELECT * FROM products WHERE id != ? AND brand = ? AND category = ? LIMIT 6")
    .all(id, product.brand, product.category);
  let picks = sameBoth.slice();
  if (picks.length < 6) {
    const sameCat = db.prepare("SELECT * FROM products WHERE id != ? AND category = ? LIMIT ?")
      .all(id, product.category, 6 - picks.length + 3);
    sameCat.forEach(function (p) { if (!picks.some(function (x) { return x.id === p.id; })) picks.push(p); });
  }
  if (picks.length < 6) {
    const anyOther = db.prepare("SELECT * FROM products WHERE id != ? LIMIT ?")
      .all(id, 6 - picks.length + 2);
    anyOther.forEach(function (p) { if (!picks.some(function (x) { return x.id === p.id; })) picks.push(p); });
  }
  res.json(picks.slice(0, 6).map(toPublic));
});

/* ============================================================
   USER PROFILE
   ============================================================ */
app.put("/api/user/profile", userAuthRequired, function (req, res) {
  const { name, email, city } = req.body || {};
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.uid);
  if (!row) return res.status(404).json({ error: "User not found." });
  db.prepare("UPDATE users SET name = ?, email = ?, city = ? WHERE id = ?").run(
    name && String(name).trim() ? String(name).trim() : row.name,
    email === undefined ? row.email : (email ? String(email).trim().toLowerCase() : null),
    city === undefined ? row.city : String(city).trim(),
    req.user.uid
  );
  const user = db.prepare("SELECT id, name, phone, email, city FROM users WHERE id = ?").get(req.user.uid);
  res.json({ user });
});

app.put("/api/user/password", userAuthRequired, function (req, res) {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Current and new password are required." });
  if (String(newPassword).length < 4) return res.status(400).json({ error: "New password must be at least 4 characters." });
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.uid);
  if (!row || !bcrypt.compareSync(String(currentPassword), row.password)) {
    return res.status(401).json({ error: "Current password is incorrect." });
  }
  const hash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hash, req.user.uid);
  res.json({ ok: true });
});

/* ============================================================
   ADDRESSES (customer address book)
   ============================================================ */
function toAddrPublic(a) {
  return {
    id: a.id,
    label: a.label,
    name: a.name,
    phone: a.phone,
    city: a.city,
    addressLine: a.address_line,
    notes: a.notes || "",
    isDefault: a.is_default === 1,
    createdAt: a.created_at
  };
}

app.get("/api/user/addresses", userAuthRequired, function (req, res) {
  const rows = db.prepare("SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC").all(req.user.uid);
  res.json(rows.map(toAddrPublic));
});

app.post("/api/user/addresses", userAuthRequired, function (req, res) {
  const { label, name, phone, city, addressLine, notes, isDefault } = req.body || {};
  if (!name || !phone || !city || !addressLine) {
    return res.status(400).json({ error: "Name, phone, city and address are required." });
  }
  const def = isDefault ? 1 : 0;
  if (def) {
    db.prepare("UPDATE addresses SET is_default = 0 WHERE user_id = ?").run(req.user.uid);
  }
  const result = db.prepare(
    "INSERT INTO addresses (user_id, label, name, phone, city, address_line, notes, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    req.user.uid,
    String(label || "Home").trim(),
    String(name).trim(),
    normalizePhone(phone),
    String(city).trim(),
    String(addressLine).trim(),
    notes ? String(notes).trim() : "",
    def
  );
  const row = db.prepare("SELECT * FROM addresses WHERE id = ?").get(result.lastInsertRowid);
  res.status(201).json(toAddrPublic(row));
});

app.put("/api/user/addresses/:id", userAuthRequired, function (req, res) {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM addresses WHERE id = ? AND user_id = ?").get(id, req.user.uid);
  if (!row) return res.status(404).json({ error: "Address not found." });
  const { label, name, phone, city, addressLine, notes, isDefault } = req.body || {};
  if (isDefault) {
    db.prepare("UPDATE addresses SET is_default = 0 WHERE user_id = ?").run(req.user.uid);
  }
  db.prepare(
    "UPDATE addresses SET label = ?, name = ?, phone = ?, city = ?, address_line = ?, notes = ?, is_default = ? WHERE id = ?"
  ).run(
    label ? String(label).trim() : row.label,
    name ? String(name).trim() : row.name,
    phone ? normalizePhone(phone) : row.phone,
    city ? String(city).trim() : row.city,
    addressLine ? String(addressLine).trim() : row.address_line,
    notes === undefined ? row.notes : String(notes).trim(),
    isDefault === undefined ? row.is_default : (isDefault ? 1 : 0),
    id
  );
  const updated = db.prepare("SELECT * FROM addresses WHERE id = ?").get(id);
  res.json(toAddrPublic(updated));
});

app.delete("/api/user/addresses/:id", userAuthRequired, function (req, res) {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM addresses WHERE id = ? AND user_id = ?").get(id, req.user.uid);
  if (!row) return res.status(404).json({ error: "Address not found." });
  db.prepare("DELETE FROM addresses WHERE id = ?").run(id);
  res.json({ ok: true });
});

/* ============================================================
   ORDER TRACKING + REORDER
   ============================================================ */
// Admin: update courier + tracking number + delivery slot + ETA
app.put("/api/admin/orders/:id/tracking", authRequired, function (req, res) {
  const id = Number(req.params.id);
  const row = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Order not found." });
  const { courier, trackingNumber, deliverySlot, estimatedDelivery } = req.body || {};
  db.prepare(
    "UPDATE orders SET courier = ?, tracking_number = ?, delivery_slot = ?, estimated_delivery = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    courier === undefined ? row.courier : String(courier || "").trim(),
    trackingNumber === undefined ? row.tracking_number : String(trackingNumber || "").trim(),
    deliverySlot === undefined ? row.delivery_slot : String(deliverySlot || "").trim(),
    estimatedDelivery === undefined ? row.estimated_delivery : String(estimatedDelivery || "").trim(),
    id
  );
  const updated = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  const items = db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").all(id);
  res.json(toOrderPublic(updated, items));
});

// Reorder: fetch an old order's items and return what's still available (frontend adds to cart)
app.get("/api/orders/:id/reorder", userAuthRequired, function (req, res) {
  const id = Number(req.params.id);
  const order = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(id, req.user.uid);
  if (!order) return res.status(404).json({ error: "Order not found." });
  const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(id);
  const result = [];
  for (const it of items) {
    const p = db.prepare("SELECT * FROM products WHERE id = ?").get(it.product_id);
    if (p && p.in_stock === 1) {
      result.push({ id: p.id, title: p.title, price: p.price, qty: it.qty, image: p.image ? "/uploads/" + p.image : null, available: true });
    } else if (p) {
      result.push({ id: p.id, title: p.title, price: p.price, qty: it.qty, image: p.image ? "/uploads/" + p.image : null, available: false });
    } else {
      result.push({ id: it.product_id, title: it.title, price: it.price, qty: it.qty, image: null, available: false, removed: true });
    }
  }
  res.json({ items: result });
});

/* ---------- error handler (multer etc.) ---------- */
app.use(function (err, req, res, next) {
  res.status(400).json({ error: err.message || "Server error." });
});

app.listen(PORT, function () {
  console.log("Amir Hardware API running at http://localhost:" + PORT);
  console.log("Admin dashboard:   http://localhost:" + PORT + "/admin.html");
  console.log("Main site:         http://localhost:" + PORT + "/");
});