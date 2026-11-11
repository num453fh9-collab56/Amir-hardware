/* Resend email helpers. Sends from onboarding@resend.dev in test mode;
   switch FROM_ADDRESS once you own a verified domain in Resend. */

const { Resend } = require("resend");

// Strip BOM and whitespace that env-var pipe tooling sometimes adds.
function clean(v) { return String(v || "").replace(/^﻿/, "").trim(); }

const API_KEY = clean(process.env.RESEND_API_KEY);
const SHOP_EMAIL = clean(process.env.SHOP_EMAIL) || "amirhardwareshop@gmail.com";
const FROM_ADDRESS = clean(process.env.RESEND_FROM) || "Amir Hardware <onboarding@resend.dev>";

const resend = API_KEY ? new Resend(API_KEY) : null;

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]
  ));
}

async function send(to, subject, html) {
  if (!resend) {
    console.warn("[email] RESEND_API_KEY missing — skipping send:", subject, "→", to);
    return { skipped: true };
  }
  try {
    const { data, error } = await resend.emails.send({ from: FROM_ADDRESS, to, subject, html });
    if (error) {
      console.error("[email] send failed:", error);
      return { error };
    }
    return { id: data && data.id };
  } catch (e) {
    console.error("[email] send threw:", e.message);
    return { error: e };
  }
}

function fmtPKR(n) { return "Rs " + Number(n || 0).toLocaleString("en-PK"); }

function orderSummaryHtml(order) {
  const items = (order.items || []).map(it => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(it.title)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${Number(it.qty) || 0}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmtPKR(it.price * it.qty)}</td>
    </tr>
  `).join("");
  return `
    <h2 style="color:#b84f15;margin:0 0 8px 0">Order ${escapeHtml(order.orderCode)}</h2>
    <p style="color:#5c4a35;margin:0 0 16px 0">Customer: <b>${escapeHtml(order.customerName)}</b> — ${escapeHtml(order.customerPhone)}</p>
    <p style="color:#5c4a35;margin:0 0 16px 0">Delivery: ${escapeHtml(order.addressLine)}, ${escapeHtml(order.city)}</p>
    <table style="width:100%;border-collapse:collapse;font-family:Inter,sans-serif;font-size:14px">
      <thead>
        <tr style="background:#fef3e9">
          <th style="padding:8px;text-align:left">Item</th>
          <th style="padding:8px;text-align:center">Qty</th>
          <th style="padding:8px;text-align:right">Line total</th>
        </tr>
      </thead>
      <tbody>${items}</tbody>
      <tfoot>
        <tr><td colspan="2" style="padding:8px;text-align:right;color:#5c4a35">Subtotal</td><td style="padding:8px;text-align:right">${fmtPKR(order.subtotal)}</td></tr>
        <tr><td colspan="2" style="padding:8px;text-align:right;color:#5c4a35">Delivery</td><td style="padding:8px;text-align:right">${order.deliveryFee > 0 ? fmtPKR(order.deliveryFee) : "Free"}</td></tr>
        ${order.discountAmount > 0 ? `<tr><td colspan="2" style="padding:8px;text-align:right;color:#5c4a35">Discount${order.couponCode ? ' ('+escapeHtml(order.couponCode)+')' : ''}</td><td style="padding:8px;text-align:right">-${fmtPKR(order.discountAmount)}</td></tr>` : ""}
        <tr><td colspan="2" style="padding:12px 8px;text-align:right;font-weight:800">Total</td><td style="padding:12px 8px;text-align:right;font-weight:800;color:#b84f15">${fmtPKR(order.total)}</td></tr>
      </tfoot>
    </table>
    <p style="color:#5c4a35;margin-top:16px;font-size:13px">Payment: ${escapeHtml(order.paymentMethod)} · Status: ${escapeHtml(order.paymentStatus)}</p>
  `;
}

async function sendOrderConfirmationToCustomer(customerEmail, order) {
  if (!customerEmail) return { skipped: true, reason: "no email" };
  const html = `
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1308">
      <h1 style="color:#b84f15;margin:0 0 8px 0">Thank you for your order!</h1>
      <p>Hi ${escapeHtml(order.customerName)}, we've received your order and will reach out to confirm delivery.</p>
      ${orderSummaryHtml(order)}
      <p style="margin-top:24px;color:#9a8c75;font-size:12px">Amir Hardware · ${escapeHtml(SHOP_EMAIL)}</p>
    </div>
  `;
  return send(customerEmail, `Order ${order.orderCode} received — Amir Hardware`, html);
}

async function sendOrderAlertToShop(order) {
  const html = `
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1308">
      <h1 style="color:#b84f15;margin:0 0 8px 0">New order received</h1>
      <p>A new order was just placed on amirhardware.com.</p>
      ${orderSummaryHtml(order)}
      ${order.notes ? `<p style="margin-top:12px;color:#5c4a35"><b>Notes:</b> ${escapeHtml(order.notes)}</p>` : ""}
    </div>
  `;
  return send(SHOP_EMAIL, `[New order] ${order.orderCode} — ${fmtPKR(order.total)}`, html);
}

async function sendContactFormToShop(payload) {
  const html = `
    <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1308">
      <h1 style="color:#b84f15;margin:0 0 8px 0">New contact form message</h1>
      <p><b>From:</b> ${escapeHtml(payload.name)} &lt;${escapeHtml(payload.email || "")}&gt;</p>
      ${payload.phone ? `<p><b>Phone:</b> ${escapeHtml(payload.phone)}</p>` : ""}
      ${payload.subject ? `<p><b>Subject:</b> ${escapeHtml(payload.subject)}</p>` : ""}
      <p style="white-space:pre-wrap;background:#fef3e9;padding:14px;border-radius:10px;border:1px solid #f3d9b4">${escapeHtml(payload.message)}</p>
    </div>
  `;
  return send(SHOP_EMAIL, `[Contact] ${payload.subject || payload.name}`, html);
}

module.exports = {
  send,
  sendOrderConfirmationToCustomer,
  sendOrderAlertToShop,
  sendContactFormToShop
};
