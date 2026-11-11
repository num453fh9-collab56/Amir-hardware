/* Vercel Blob upload helper. Accepts a multer in-memory file and returns the public URL. */

const path = require("path");
const { put } = require("@vercel/blob");

const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const ALLOWED_MIMES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "image/avif"
]);

function pickExt(originalname, mimetype) {
  const raw = path.extname(originalname || "").toLowerCase();
  if (ALLOWED_EXTS.has(raw)) return raw;
  if (mimetype === "image/png") return ".png";
  if (mimetype === "image/gif") return ".gif";
  if (mimetype === "image/webp") return ".webp";
  if (mimetype === "image/avif") return ".avif";
  return ".jpg";
}

async function uploadImage(file) {
  if (!file) return null;
  if (!ALLOWED_MIMES.has(file.mimetype)) {
    throw new Error("Only JPEG, PNG, GIF, WEBP or AVIF images are allowed.");
  }
  const ext = pickExt(file.originalname, file.mimetype);
  const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
  const pathname = "products/product-" + unique + ext;
  const blob = await put(pathname, file.buffer, {
    access: "public",
    contentType: file.mimetype,
    addRandomSuffix: false
  });
  return blob.url;
}

module.exports = { uploadImage, ALLOWED_MIMES, ALLOWED_EXTS };
