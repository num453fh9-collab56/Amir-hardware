/* ============================================================
   AMIR HARDWARE — Admin Dashboard (admin.js)
   JWT auth, product CRUD, stock toggle, image uploads
   ============================================================ */

(function () {
  "use strict";

  const API = "/api";
  const TOKEN_KEY = "ah_admin_token";
  const NAME_KEY = "ah_admin_name";

  const loginScreen = document.getElementById("login-screen");
  const dashboard = document.getElementById("dashboard");
  const loginForm = document.getElementById("login-form");
  const loginEmail = document.getElementById("login-email");
  const loginPassword = document.getElementById("login-password");
  const loginError = document.getElementById("login-error");
  const loginBtn = document.getElementById("login-btn");
  const loginBtnText = document.getElementById("login-btn-text");

  const adminChip = document.getElementById("admin-chip");
  const logoutBtn = document.getElementById("logout-btn");

  const productsTbody = document.getElementById("products-tbody");
  const tableLoading = document.getElementById("table-loading");
  const emptyState = document.getElementById("empty-state");
  const searchInput = document.getElementById("search-input");
  const catFilter = document.getElementById("cat-filter");

  const statTotal = document.getElementById("stat-total");
  const statIn = document.getElementById("stat-in");
  const statOut = document.getElementById("stat-out");

  const productModal = document.getElementById("product-modal");
  const productForm = document.getElementById("product-form");
  const modalTitle = document.getElementById("modal-title");
  const fTitle = document.getElementById("f-title");
  const fCategory = document.getElementById("f-category");
  const fPrice = document.getElementById("f-price");
  const fDesc = document.getElementById("f-desc");
  const fImage = document.getElementById("f-image");
  const imgPreview = document.getElementById("img-preview");
  const imgFilename = document.getElementById("img-filename");
  const fStock = document.getElementById("f-stock");

  const deleteModal = document.getElementById("delete-modal");
  const deleteName = document.getElementById("delete-name");
  const confirmDelete = document.getElementById("confirm-delete");

  const toast = document.getElementById("toast");

  let products = [];
  let editingId = null;
  let pendingDelete = null;
  let toastTimer = null;

  /* ---------- helpers ---------- */
  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setToken(token, name) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(NAME_KEY, name || "Admin");
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(NAME_KEY);
  }

  function showToast(message, isError) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.toggle("error", !!isError);
    toast.classList.add("show");
    toastTimer = setTimeout(function () {
      toast.classList.remove("show");
    }, 3200);
  }

  function authHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: "Bearer " + getToken()
    };
  }

  async function api(path, options) {
    const res = await fetch(API + path, options);
    const data = await res.json().catch(function () { return {}; });
    if (res.status === 401) {
      clearToken();
      showLogin();
      showToast("Session expired — please log in again.", true);
      throw new Error("Unauthorized");
    }
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------- auth UI ---------- */
  function showLogin() {
    dashboard.style.display = "none";
    loginScreen.style.display = "grid";
  }

  function showDashboard(name) {
    loginScreen.style.display = "none";
    dashboard.style.display = "flex";
    dashboard.removeAttribute("hidden");
    var displayName = name || "Admin";
    adminChip.textContent = displayName;
    var initials = displayName.split(" ").map(function(w){ return w[0]; }).join("").slice(0,2).toUpperCase();
    var av1 = document.getElementById("user-avatar"); if (av1) av1.textContent = initials;
    var av2 = document.getElementById("sid-avatar"); if (av2) av2.textContent = initials;
    var sn = document.getElementById("sid-name"); if (sn) sn.textContent = displayName;
    var wn = document.getElementById("welcome-name"); if (wn) wn.textContent = displayName.split(" ")[0];
    loadProducts();
  }

  loginForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const email = loginEmail.value.trim();
    const password = loginPassword.value;
    if (!email || !password) {
      loginError.textContent = "Please enter both email and password.";
      return;
    }
    loginError.textContent = "";
    loginBtn.disabled = true;
    loginBtnText.textContent = "Signing in…";
    try {
      const data = await api("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: password })
      });
      setToken(data.token, data.admin.name);
      showDashboard(data.admin.name);
      showToast("Welcome back, " + data.admin.name + "!");
    } catch (err) {
      loginError.textContent = err.message === "Unauthorized" ? "Invalid email or password." : err.message;
    } finally {
      loginBtn.disabled = false;
      loginBtnText.textContent = "Sign In to Dashboard";
    }
  });

  logoutBtn.addEventListener("click", function () {
    clearToken();
    loginPassword.value = "";
    showLogin();
    showToast("Logged out.");
  });

  /* ---------- product rendering ---------- */
  function renderProducts() {
    const q = searchInput.value.trim().toLowerCase();
    const cat = catFilter.value;

    const filtered = products.filter(function (p) {
      const matchQ = !q || p.title.toLowerCase().indexOf(q) !== -1 || p.category.toLowerCase().indexOf(q) !== -1;
      const matchCat = !cat || p.category === cat;
      return matchQ && matchCat;
    });

    tableLoading.hidden = true;
    emptyState.hidden = filtered.length > 0;

    productsTbody.innerHTML = filtered
      .map(function (p) {
        const thumb =
          '<span class="thumb">' +
          (p.image
            ? '<img src="' + p.image + '" alt="" loading="lazy" onerror="this.parentElement.innerHTML=\'\\uD83D\\uDCE6\'" />'
            : "📦") +
          "</span>";

        return (
          '<tr>' +
          '<td><div class="prod-cell">' + thumb +
          '<div><p class="pt">' + escapeHtml(p.title) + '</p><p class="pc">' +
          (p.description ? escapeHtml(p.description.slice(0, 60)) + (p.description.length > 60 ? "…" : "") : "No description") +
          "</p></div></div></td>" +
          '<td><span class="cat-chip">' + escapeHtml(p.category) + "</span></td>" +
          '<td class="price">Rs ' + Number(p.price || 0).toLocaleString("en-PK") + "</td>" +
          '<td><button type="button" class="stock-pill ' + (p.inStock ? "in" : "out") + '" data-stock="' + p.id + '">' +
          '<span class="dot"></span>' + (p.inStock ? "IN STOCK" : "OUT OF STOCK") + "</button></td>" +
          '<td><div class="row-actions">' +
          '<button type="button" class="icon-btn edit" data-edit="' + p.id + '">✏️ Edit</button>' +
          '<button type="button" class="icon-btn del" data-del="' + p.id + '">🗑️ Delete</button>' +
          "</div></td>" +
          "</tr>"
        );
      })
      .join("");

    const inCount = products.filter(function (p) { return p.inStock; }).length;
    statTotal.textContent = products.length;
    statIn.textContent = inCount;
    statOut.textContent = products.length - inCount;
  }

  async function loadProducts() {
    try {
      const data = await api("/products");
      products = data;
      window.__PRODUCTS_CACHE = data;
      const cats = Array.from(new Set(data.map(function (p) { return p.category; }))).sort();
      catFilter.innerHTML = '<option value="">All Categories</option>' +
        cats.map(function (c) { return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + "</option>"; }).join("");
      renderProducts();
      if (typeof window.updateDashboardKPIs === "function") window.updateDashboardKPIs(products, window.__ORDERS_CACHE || []);
    } catch (err) {
      tableLoading.hidden = true;
      productsTbody.innerHTML = "";
      emptyState.hidden = false;
      emptyState.querySelector("p").textContent = "Could not load products: " + err.message;
    }
  }

  searchInput.addEventListener("input", renderProducts);
  catFilter.addEventListener("change", renderProducts);

  /* ---------- product modal (add / edit) ---------- */
  function openModal() {
    productModal.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(function () { fTitle.focus(); }, 60);
  }

  function closeModal() {
    productModal.hidden = true;
    document.body.style.overflow = "";
  }

  document.querySelectorAll("[data-close-modal]").forEach(function (btn) {
    btn.addEventListener("click", closeModal);
  });

  [productModal, deleteModal].forEach(function (modal) {
    modal.addEventListener("click", function (e) {
      if (e.target === modal) {
        modal.hidden = true;
        document.body.style.overflow = "";
      }
    });
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      productModal.hidden = true;
      deleteModal.hidden = true;
      document.body.style.overflow = "";
    }
  });

  function resetForm() {
    productForm.reset();
    fStock.checked = true;
    imgPreview.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>';
    imgFilename.textContent = "No file selected — optional";
    fImage.value = "";
  }

  document.getElementById("add-btn").addEventListener("click", function () {
    editingId = null;
    resetForm();
    modalTitle.innerHTML = "Add <span>New Product</span>";
    openModal();
  });

  productsTbody.addEventListener("click", function (e) {
    const editBtn = e.target.closest("[data-edit]");
    const delBtn = e.target.closest("[data-del]");
    const stockBtn = e.target.closest("[data-stock]");

    if (editBtn) {
      const p = products.find(function (x) { return x.id === Number(editBtn.getAttribute("data-edit")); });
      if (!p) return;
      editingId = p.id;
      resetForm();
      fTitle.value = p.title;
      fCategory.value = p.category;
      fPrice.value = p.price;
      fDesc.value = p.description;
      fStock.checked = p.inStock;
      if (p.image) {
        imgPreview.innerHTML = '<img src="' + p.image + '" alt="" />';
        imgFilename.textContent = "Current image: " + p.image.split("/").pop();
      }
      modalTitle.innerHTML = "Edit <span>Product</span>";
      openModal();
    }

    if (delBtn) {
      const p = products.find(function (x) { return x.id === Number(delBtn.getAttribute("data-del")); });
      if (!p) return;
      pendingDelete = p.id;
      deleteName.textContent = p.title;
      deleteModal.hidden = false;
    }

    if (stockBtn) {
      toggleStock(Number(stockBtn.getAttribute("data-stock")));
    }
  });

  fImage.addEventListener("change", function () {
    const file = fImage.files && fImage.files[0];
    if (!file) return;
    imgFilename.textContent = file.name + " (" + (file.size / 1024 / 1024).toFixed(2) + " MB)";
    const reader = new FileReader();
    reader.onload = function (ev) {
      imgPreview.innerHTML = '<img src="' + ev.target.result + '" alt="" />';
    };
    reader.readAsDataURL(file);
  });

  productForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    if (!fTitle.value.trim() || !fCategory.value.trim() || fPrice.value === "") {
      showToast("Please fill Title, Category and Price.", true);
      return;
    }

    const fd = new FormData();
    fd.append("title", fTitle.value.trim());
    fd.append("category", fCategory.value.trim());
    fd.append("price", fPrice.value);
    fd.append("description", fDesc.value.trim());
    fd.append("in_stock", fStock.checked ? "1" : "0");
    if (fImage.files[0]) fd.append("image", fImage.files[0]);

    const url = editingId ? "/products/" + editingId : "/products";
    const method = editingId ? "PUT" : "POST";

    try {
      await fetch(API + url, {
        method: method,
        headers: { Authorization: "Bearer " + getToken() },
        body: fd
      }).then(async function (res) {
        if (res.status === 401) throw { unauthenticated: true };
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(data.error || "Save failed");
        return data;
      });
      showToast(editingId ? "Product updated successfully." : "Product added successfully.");
      closeModal();
      loadProducts();
    } catch (err) {
      if (err.unauthenticated) return;
      showToast("Save failed: " + err.message, true);
    }
  });

  confirmDelete.addEventListener("click", async function () {
    if (!pendingDelete) return;
    try {
      await api("/products/" + pendingDelete, { method: "DELETE", headers: authHeaders() });
      showToast("Product deleted.");
      deleteModal.hidden = true;
      document.body.style.overflow = "";
      pendingDelete = null;
      loadProducts();
    } catch (err) {
      showToast("Delete failed: " + err.message, true);
    }
  });

  /* ---------- stock toggle ---------- */
  async function toggleStock(id) {
    const p = products.find(function (x) { return x.id === id; });
    if (!p) return;
    const next = !p.inStock;
    try {
      await api("/products/" + id, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ in_stock: next ? 1 : 0 })
      });
      p.inStock = next;
      renderProducts();
      showToast('"' + p.title + '" is now ' + (next ? "IN STOCK" : "OUT OF STOCK") + ".");
    } catch (err) {
      showToast("Stock update failed: " + err.message, true);
    }
  }

  /* ---------- orders ---------- */
  let ORDERS_CACHE = [];
  const STATUS_LIST = ["placed", "confirmed", "packed", "shipped", "delivered", "cancelled"];
  const PAY_STATUS_LIST = ["cod_pending", "awaiting_payment", "paid", "failed", "refunded"];

  async function loadOrders() {
    const tbody = document.getElementById("orders-tbody");
    const empty = document.getElementById("ord-empty");
    if (!tbody) return;
    tbody.innerHTML = '<tr class="loading-row"><td colspan="7"><span class="spinner"></span> Loading orders…</td></tr>';
    empty && empty.setAttribute("hidden", "");
    try {
      const token = getToken();
      const res = await fetch(API + "/admin/orders", { headers: { Authorization: "Bearer " + token } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      ORDERS_CACHE = await res.json();
      window.__ORDERS_CACHE = ORDERS_CACHE;
      renderOrders();
      if (typeof window.updateDashboardKPIs === "function") window.updateDashboardKPIs(window.__PRODUCTS_CACHE || [], ORDERS_CACHE);
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="7" style="color:#f87171;text-align:center;padding:14px">Could not load orders: ' + err.message + '</td></tr>';
    }
  }

  function fmtPKR(n) { return "Rs " + Number(n || 0).toLocaleString("en-PK"); }

  function renderOrders() {
    const tbody = document.getElementById("orders-tbody");
    const empty = document.getElementById("ord-empty");
    const filter = (document.getElementById("ord-status-filter") || {}).value || "";
    const list = ORDERS_CACHE.filter(o => !filter || o.status === filter);
    if (list.length === 0) {
      tbody.innerHTML = "";
      empty && empty.removeAttribute("hidden");
      return;
    }
    empty && empty.setAttribute("hidden", "");
    tbody.innerHTML = list.map(o => {
      const itemsCount = (o.items || []).reduce((s, it) => s + (it.qty || 1), 0);
      const dateStr = new Date(o.createdAt + "Z").toLocaleDateString("en-PK", { day: "numeric", month: "short" });
      return `<tr>
        <td><b style="color:#f3a05d">${o.orderCode}</b><br/><small style="color:#999">${dateStr}</small></td>
        <td>${o.customerName}<br/><small style="color:#999">${o.customerPhone}</small></td>
        <td>${itemsCount} item${itemsCount === 1 ? "" : "s"}<br/><small style="color:#999">${o.city}</small></td>
        <td><b>${fmtPKR(o.total)}</b></td>
        <td><small>${(o.paymentMethod || "").replace("_", " ")}</small><br/><small style="color:#999">${(o.paymentStatus || "").replace("_", " ")}</small></td>
        <td>
          <select class="ord-status-sel" data-id="${o.id}" style="background:#1e1e1e;color:#eee;border:1px solid #333;padding:4px 8px;border-radius:6px;font-size:12px">
            ${STATUS_LIST.map(s => '<option value="' + s + '"' + (s === o.status ? " selected" : "") + ">" + s + "</option>").join("")}
          </select>
        </td>
        <td>
          <button class="btn-mini ord-view" data-id="${o.id}" style="background:#333;color:#f3a05d;border:1px solid #444;padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer">View</button>
        </td>
      </tr>`;
    }).join("");

    tbody.querySelectorAll(".ord-status-sel").forEach(sel => {
      sel.addEventListener("change", async e => {
        const id = Number(e.target.getAttribute("data-id"));
        const newStatus = e.target.value;
        try {
          const token = getToken();
          const res = await fetch(API + "/admin/orders/" + id + "/status", {
            method: "PUT",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
            body: JSON.stringify({ status: newStatus })
          });
          if (!res.ok) throw new Error("Update failed");
          const updated = await res.json();
          const idx = ORDERS_CACHE.findIndex(x => x.id === id);
          if (idx >= 0) ORDERS_CACHE[idx] = Object.assign({}, ORDERS_CACHE[idx], updated);
          showToast("Order " + updated.orderCode + " → " + newStatus);
        } catch (err) {
          showToast("Status update failed", true);
        }
      });
    });

    tbody.querySelectorAll(".ord-view").forEach(btn => {
      btn.addEventListener("click", e => openOrderDetail(Number(e.target.getAttribute("data-id"))));
    });
  }

  function openOrderDetail(id) {
    const o = ORDERS_CACHE.find(x => x.id === id);
    if (!o) return;
    const modal = document.getElementById("order-modal");
    document.getElementById("ord-mod-code").textContent = o.orderCode;
    const itemsHtml = (o.items || []).map(it => `
      <div style="display:flex;gap:12px;padding:10px;background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;margin-bottom:8px">
        <img src="${it.image || "images/logo.png"}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;flex-shrink:0"/>
        <div style="flex:1;min-width:0">
          <p style="color:#eee;font-weight:600;font-size:13px">${it.title}</p>
          <p style="color:#888;font-size:11px">${it.brand || ""} · Qty ${it.qty} × ${fmtPKR(it.price)}</p>
        </div>
        <b style="color:#f3a05d">${fmtPKR(it.price * it.qty)}</b>
      </div>`).join("");

    document.getElementById("ord-mod-body").innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div>
          <p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em">Customer</p>
          <p style="color:#eee;font-weight:600">${o.customerName}</p>
          <p style="color:#aaa;font-size:13px">${o.customerPhone}</p>
          ${o.userName ? '<p style="color:#666;font-size:11px">Account: ' + o.userName + '</p>' : ""}
        </div>
        <div>
          <p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em">Delivery</p>
          <p style="color:#eee;font-weight:600">${o.city}</p>
          <p style="color:#aaa;font-size:13px">${o.addressLine}</p>
          ${o.deliveryDate ? '<p style="color:#666;font-size:11px">Preferred: ' + o.deliveryDate + '</p>' : ""}
        </div>
        <div>
          <p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em">Payment</p>
          <p style="color:#eee;font-weight:600">${(o.paymentMethod || "").replace("_", " ")}</p>
          <p style="color:#aaa;font-size:13px">${(o.paymentStatus || "").replace("_", " ")}</p>
        </div>
        <div>
          <p style="color:#5c4a35;font-size:10px;text-transform:uppercase;letter-spacing:0.14em;font-weight:700;margin-bottom:4px">Status</p>
          <select id="ord-detail-status" style="background:#fff;color:#1a1308;border:1px solid rgba(201,162,77,0.3);padding:7px 10px;border-radius:9px;width:100%;font-weight:600">
            ${STATUS_LIST.map(s => '<option value="' + s + '"' + (s === o.status ? " selected" : "") + ">" + s + "</option>").join("")}
          </select>
          <select id="ord-detail-pstatus" style="background:#fff;color:#1a1308;border:1px solid rgba(201,162,77,0.3);padding:7px 10px;border-radius:9px;width:100%;margin-top:6px;font-weight:600">
            ${PAY_STATUS_LIST.map(s => '<option value="' + s + '"' + (s === o.paymentStatus ? " selected" : "") + ">" + s.replace("_", " ") + "</option>").join("")}
          </select>
          <button id="ord-detail-save" style="background:linear-gradient(135deg,#f3a05d,#b84f15);color:#fff;border:none;padding:9px 16px;border-radius:10px;cursor:pointer;margin-top:8px;font-weight:700;width:100%;font-size:12px;letter-spacing:0.08em;text-transform:uppercase">Save Status</button>
        </div>
      </div>

      <div style="margin-bottom:14px;padding:14px;background:rgba(237,127,60,0.06);border:1px solid rgba(237,127,60,0.22);border-radius:12px">
        <p style="color:#b84f15;font-size:10px;text-transform:uppercase;letter-spacing:0.14em;font-weight:800;margin-bottom:10px">Courier &amp; Tracking</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div>
            <label style="color:#5c4a35;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700">Courier</label>
            <select id="ord-detail-courier" style="background:#fff;color:#1a1308;border:1px solid rgba(201,162,77,0.3);padding:7px 10px;border-radius:9px;width:100%;margin-top:4px;font-weight:600">
              <option value="">— Select —</option>
              <option value="TCS"${o.courier === "TCS" ? " selected" : ""}>TCS</option>
              <option value="Leopards"${o.courier === "Leopards" ? " selected" : ""}>Leopards</option>
              <option value="Call Courier"${o.courier === "Call Courier" ? " selected" : ""}>Call Courier</option>
              <option value="Postex"${o.courier === "Postex" ? " selected" : ""}>Postex</option>
              <option value="Trax"${o.courier === "Trax" ? " selected" : ""}>Trax</option>
              <option value="M&P"${o.courier === "M&P" ? " selected" : ""}>M&amp;P</option>
              <option value="In-House"${o.courier === "In-House" ? " selected" : ""}>In-House Delivery</option>
              <option value="Rider"${o.courier === "Rider" ? " selected" : ""}>Bike Rider</option>
            </select>
          </div>
          <div>
            <label style="color:#5c4a35;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700">Tracking Number</label>
            <input id="ord-detail-tracking" type="text" value="${(o.trackingNumber || "").replace(/"/g, '&quot;')}" placeholder="e.g. TCS12345678" style="background:#fff;color:#1a1308;border:1px solid rgba(201,162,77,0.3);padding:7px 10px;border-radius:9px;width:100%;margin-top:4px;font-weight:600"/>
          </div>
          <div>
            <label style="color:#5c4a35;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700">Delivery Slot</label>
            <select id="ord-detail-slot" style="background:#fff;color:#1a1308;border:1px solid rgba(201,162,77,0.3);padding:7px 10px;border-radius:9px;width:100%;margin-top:4px;font-weight:600">
              <option value="">— Any —</option>
              <option value="Morning (9am-12pm)"${o.deliverySlot === "Morning (9am-12pm)" ? " selected" : ""}>Morning (9am-12pm)</option>
              <option value="Afternoon (12pm-4pm)"${o.deliverySlot === "Afternoon (12pm-4pm)" ? " selected" : ""}>Afternoon (12pm-4pm)</option>
              <option value="Evening (4pm-8pm)"${o.deliverySlot === "Evening (4pm-8pm)" ? " selected" : ""}>Evening (4pm-8pm)</option>
            </select>
          </div>
          <div>
            <label style="color:#5c4a35;font-size:10px;text-transform:uppercase;letter-spacing:0.12em;font-weight:700">Estimated Delivery</label>
            <input id="ord-detail-eta" type="date" value="${o.estimatedDelivery || ""}" style="background:#fff;color:#1a1308;border:1px solid rgba(201,162,77,0.3);padding:7px 10px;border-radius:9px;width:100%;margin-top:4px;font-weight:600"/>
          </div>
        </div>
        <button id="ord-detail-track-save" style="background:linear-gradient(135deg,#f3a05d,#b84f15);color:#fff;border:none;padding:9px 16px;border-radius:10px;cursor:pointer;margin-top:10px;font-weight:700;width:100%;font-size:12px;letter-spacing:0.08em;text-transform:uppercase">Save Tracking Info</button>
      </div>

      ${o.notes ? '<div style="margin-bottom:12px;padding:10px;background:rgba(255,255,255,0.6);border:1px solid rgba(201,162,77,0.25);border-radius:10px"><p style="color:#5c4a35;font-size:10px;text-transform:uppercase;letter-spacing:0.14em;font-weight:700;margin-bottom:4px">Notes</p><p style="color:#1a1308;font-size:13px">' + o.notes + '</p></div>' : ""}
      <p style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px">Items</p>
      ${itemsHtml}
      <div style="margin-top:12px;padding:12px;background:#1a1a1a;border-radius:10px">
        <div style="display:flex;justify-content:space-between;color:#aaa;font-size:13px"><span>Subtotal</span><span>${fmtPKR(o.subtotal)}</span></div>
        <div style="display:flex;justify-content:space-between;color:#aaa;font-size:13px;margin-top:4px"><span>Delivery</span><span>${o.deliveryFee === 0 ? "Free" : fmtPKR(o.deliveryFee)}</span></div>
        <div style="display:flex;justify-content:space-between;color:#f3a05d;font-weight:700;font-size:15px;margin-top:8px;padding-top:8px;border-top:1px solid #333"><span>Total</span><span>${fmtPKR(o.total)}</span></div>
      </div>
    `;
    modal.removeAttribute("hidden");

    document.getElementById("ord-detail-save").addEventListener("click", async () => {
      const newStatus = document.getElementById("ord-detail-status").value;
      const newPStatus = document.getElementById("ord-detail-pstatus").value;
      try {
        const token = getToken();
        const res = await fetch(API + "/admin/orders/" + o.id + "/status", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ status: newStatus, paymentStatus: newPStatus })
        });
        if (!res.ok) throw new Error("Update failed");
        const updated = await res.json();
        const idx = ORDERS_CACHE.findIndex(x => x.id === o.id);
        if (idx >= 0) ORDERS_CACHE[idx] = Object.assign({}, ORDERS_CACHE[idx], updated);
        renderOrders();
        showToast("Status updated → " + newStatus);
      } catch (err) {
        showToast("Save failed", true);
      }
    });

    const trackBtn = document.getElementById("ord-detail-track-save");
    if (trackBtn) trackBtn.addEventListener("click", async () => {
      const payload = {
        courier: document.getElementById("ord-detail-courier").value,
        trackingNumber: document.getElementById("ord-detail-tracking").value.trim(),
        deliverySlot: document.getElementById("ord-detail-slot").value,
        estimatedDelivery: document.getElementById("ord-detail-eta").value
      };
      try {
        const token = getToken();
        const res = await fetch(API + "/admin/orders/" + o.id + "/tracking", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error("Save failed");
        const updated = await res.json();
        const idx = ORDERS_CACHE.findIndex(x => x.id === o.id);
        if (idx >= 0) ORDERS_CACHE[idx] = Object.assign({}, ORDERS_CACHE[idx], updated);
        renderOrders();
        showToast("Tracking info saved ✓");
      } catch (err) {
        showToast("Save failed", true);
      }
    });
  }

  // Wire up orders UI
  document.addEventListener("click", e => {
    const t = e.target;
    if (t && t.hasAttribute && t.hasAttribute("data-close-modal")) {
      const m = t.closest(".modal-backdrop");
      if (m) m.setAttribute("hidden", "");
    }
  });
  const ordRefresh = document.getElementById("ord-refresh");
  if (ordRefresh) ordRefresh.addEventListener("click", loadOrders);
  const ordFilter = document.getElementById("ord-status-filter");
  if (ordFilter) ordFilter.addEventListener("change", renderOrders);

  // Override showDashboard to also load orders
  const _origShowDashboard = showDashboard;
  showDashboard = function (name) {
    _origShowDashboard(name);
    loadOrders();
  };

  /* ---------- boot ---------- */
  if (getToken()) {
    showDashboard(localStorage.getItem(NAME_KEY));
  } else {
    showLogin();
  }
})();
