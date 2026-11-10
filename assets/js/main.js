/* ============================================================
   AMIR HARDWARE — main.js
   Navbar state, mobile menu, search panel, arrows, scrollspy,
   scroll reveals
   ============================================================ */

(function () {
  "use strict";

  const navbar = document.getElementById("navbar");
  const navToggle = document.getElementById("nav-toggle");
  const navLinks = document.getElementById("nav-links");
  const yearEl = document.getElementById("year");

  const searchToggle = document.getElementById("search-toggle");
  const searchPanel = document.getElementById("search-panel");
  const searchInput = document.getElementById("search-input");
  const searchClose = document.getElementById("search-close");

  /* ---------- footer year ---------- */
  yearEl.textContent = new Date().getFullYear();

  /* ---------- navbar on scroll ---------- */
  function onScroll() {
    navbar.classList.toggle("scrolled", window.scrollY > 24);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- mobile menu toggle ---------- */
  function closeMenu() {
    navLinks.classList.remove("open");
    navToggle.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  }

  navToggle.addEventListener("click", function () {
    const open = navLinks.classList.toggle("open");
    navToggle.classList.toggle("open", open);
    navToggle.setAttribute("aria-expanded", String(open));
  });

  navLinks.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", closeMenu);
  });

  document.addEventListener("click", function (e) {
    if (
      navLinks.classList.contains("open") &&
      !navLinks.contains(e.target) &&
      !navToggle.contains(e.target)
    ) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closeMenu();
      closeSearch();
    }
  });

  /* ---------- search panel ---------- */
  function openSearch() {
    searchPanel.classList.add("open");
    searchPanel.setAttribute("aria-hidden", "false");
    searchToggle.setAttribute("aria-expanded", "true");
    setTimeout(function () { searchInput.focus(); }, 200);
  }

  function closeSearch() {
    searchPanel.classList.remove("open");
    searchPanel.setAttribute("aria-hidden", "true");
    searchToggle.setAttribute("aria-expanded", "false");
  }

  searchToggle.addEventListener("click", function () {
    if (searchPanel.classList.contains("open")) {
      closeSearch();
    } else {
      openSearch();
    }
  });

  searchClose.addEventListener("click", closeSearch);

  searchInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      closeSearch();
      document.getElementById("categories").scrollIntoView({ behavior: "smooth" });
    }
  });

  /* ---------- bottom-right arrows ---------- */
  const arrowPrev = document.getElementById("arrow-prev");
  const arrowNext = document.getElementById("arrow-next");

  if (arrowPrev) {
    arrowPrev.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  if (arrowNext) {
    arrowNext.addEventListener("click", function () {
      document.getElementById("categories").scrollIntoView({ behavior: "smooth" });
    });
  }

  /* ---------- active link highlighting ---------- */
  const sections = document.querySelectorAll("section[id], .anchor[id]");
  const menuAnchors = Array.from(navLinks.querySelectorAll(".nav-link"));

  function setActive(id) {
    menuAnchors.forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("href") === "#" + id);
    });
  }

  const sectionObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) setActive(entry.target.id);
      });
    },
    { rootMargin: "-40% 0px -55% 0px" }
  );

  sections.forEach(function (section) {
    sectionObserver.observe(section);
  });

  /* ---------- reveal on scroll ---------- */
  const revealEls = document.querySelectorAll(".reveal");

  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );

    revealEls.forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    revealEls.forEach(function (el) {
      el.classList.add("visible");
    });
  }

  /* ============================================================
     SMART MATERIAL & BUDGET ESTIMATOR
     ============================================================ */
  const estPills = document.querySelectorAll(".est-pill");
  const estArea = document.getElementById("est-area");
  const estCount = document.getElementById("est-count");
  const estHint = document.getElementById("est-hint");
  const estRange = document.getElementById("est-range");
  const estList = document.getElementById("est-list");
  const estWhats = document.getElementById("est-whats");
  const WA_NUMBER = "923007090124";

  const PROJECTS = {
    sanitary: {
      name: "Bathroom Sanitary",
      hint: "Tip: 1 bathroom typically covers ~400 sq ft of project area. Enter bathrooms, or let the area auto-estimate it.",
      items: function (bathrooms, sq) {
        return [
          ["Wall-hung WC set", bathrooms, "sets"],
          ["Basin + chrome mixer", bathrooms, "sets"],
          ["Luxury shower set", bathrooms, "sets"],
          ["Towel rails & accessories", bathrooms * 2, "pcs"],
          ["CPVC pipes", Math.max(10, Math.round(sq * 0.35)), "ft"],
          ["Pipe fittings (elbow/tee)", Math.max(6, Math.round(sq * 0.18)), "pcs"],
          ["Angle valves", bathrooms * 2, "pcs"],
          ["Silicone & sealant kit", bathrooms, "kits"]
        ];
      },
      budget: function (bathrooms, sq) {
        return [bathrooms * 38000 + sq * 18, bathrooms * 85000 + sq * 42];
      }
    },
    kitchen: {
      name: "Kitchen Fitting",
      hint: "Tip: 1 kitchen typically covers ~250 sq ft. Enter kitchens, or let the area auto-estimate it.",
      items: function (kitchens, sq) {
        return [
          ["Multifunctional waterfall sink", kitchens, "pcs"],
          ["Pull-down chrome faucet", kitchens, "pcs"],
          ["Modular kitchen units", kitchens * 4, "units"],
          ["Granite / acrylic counter", Math.max(6, Math.round(sq * 0.28)), "ft"],
          ["Kitchen wall tiles", Math.max(20, Math.round(sq * 0.6)), "sq ft"],
          ["Undersink RO connection kit", kitchens, "kits"]
        ];
      },
      budget: function (kitchens, sq) {
        return [kitchens * 55000 + sq * 22, kitchens * 120000 + sq * 50];
      }
    },
    paint: {
      name: "Paint & Coating",
      hint: "Tip: enter the total area in sq ft \u2014 1 gallon covers ~150 sq ft (2 coats).",
      items: function (count, area) {
        const gallons = Math.max(2, Math.ceil(area / 150));
        return [
          ["Premium emulsion", gallons, "gallons"],
          ["Primer", Math.max(1, Math.ceil(gallons / 2)), "gallons"],
          ["Wall putty", Math.max(2, Math.ceil(area / 300)), "bags"],
          ["Weathercoat exterior", Math.max(1, Math.ceil(area / 200)), "gallons"],
          ["Roller & brush kit", 1, "kit"],
          ["Masking tape", Math.max(1, Math.ceil(area / 500)), "rolls"]
        ];
      },
      budget: function (count, area) {
        const gallons = Math.max(2, Math.ceil(area / 150));
        return [gallons * 4500, gallons * 7500 + 15000];
      }
    }
  };

  function renderEstimate() {
    const project = PROJECTS[currentProject];
    const area = parseFloat(estArea.value) || 0;
    const count = parseInt(estCount.value, 10) || 0;
    const isPaint = currentProject === "paint";
    const unitCount = count || (isPaint ? 0 : Math.max(1, Math.ceil((area || 1) / (currentProject === "sanitary" ? 400 : 250))));
    const sq = area || (isPaint ? Math.max(1, count * 150) : unitCount * (currentProject === "sanitary" ? 400 : 250));

    const items = project.items(unitCount, sq);
    const budget = project.budget(unitCount, sq);

    estHint.textContent = project.hint;

    estList.innerHTML = items
      .map(function (row) {
        return '<li><span>' + row[0] + '</span><span class="est-qty">' + row[1] + ' <span class="est-unit">' + row[2] + "</span></span></li>";
      })
      .join("");

    estRange.textContent = "Rs " + budget[0].toLocaleString("en-PK") + " \u2013 " + budget[1].toLocaleString("en-PK");

    const summary = items
      .map(function (row) {
        return "- " + row[0] + ": " + row[1] + " " + row[2];
      })
      .join("%0A");
    const msg =
      "Assalam-o-Alaikum!%0A" +
      "Main Amir Hardware se " + project.name + " project ka material budget pooch raha hoon.%0A" +
      "Area: " + sq + " sq ft, Count: " + (count || unitCount) + "%0A%0A" +
      "Estimated Material:%0A" + summary + "%0A%0A" +
      "Estimated Budget: Rs " + budget[0].toLocaleString("en-PK") + " \u2013 " + budget[1].toLocaleString("en-PK");

    estWhats.href = "https://wa.me/" + WA_NUMBER + "?text=" + msg;
  }

  let currentProject = "sanitary";

  estPills.forEach(function (pill) {
    pill.addEventListener("click", function () {
      currentProject = pill.getAttribute("data-project");
      estPills.forEach(function (p) {
        p.classList.toggle("active", p === pill);
        p.setAttribute("aria-selected", String(p === pill));
      });
      renderEstimate();
    });
  });

  estArea.addEventListener("input", renderEstimate);
  estCount.addEventListener("input", renderEstimate);
  renderEstimate();
/* ============================================================
     DYNAMIC PRODUCT CATALOGUE
     Fetches products from the Amir Hardware backend API and
     renders real uploaded photos into the premium grid.
     Falls back to the static showcase if the API is offline.
     ============================================================ */
  const API_BASE = "";
  const premGrid = document.getElementById("prem-grid");
  const catalogueStatus = document.getElementById("catalogue-status");

  const PH_PLACEHOLDER =
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9f6f6"/><stop offset="1" stop-color="#d7eeee"/></linearGradient></defs><rect width="600" height="400" fill="url(#g)"/><g transform="translate(288,160)" stroke="#0f766e" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M6-34 2-6h14L-6 34 4-2h-14Z"/></g><text x="300" y="248" fill="#0f766e" font-family="Arial" font-size="22" font-weight="bold" text-anchor="middle" letter-spacing="4">AMIR HARDWARE</text><text x="300" y="278" fill="#5b7a79" font-family="Arial" font-size="13" text-anchor="middle" letter-spacing="2">PHOTO COMING SOON</text></svg>'
    );

  function buildProductCard(p) {
    const cat = p.category || "General";
    const stockIn = p.inStock !== false;
    const stockBadge = stockIn
      ? 'background: #22c55e; color: #fff;'
      : 'background: rgba(239, 68, 68, 0.9); color: #fff;';
    const stockText = stockIn ? "IN STOCK" : "OUT OF STOCK";
    const img = p.image ? API_BASE + p.image : PH_PLACEHOLDER;
    const priceVal = Number(p.price) || 0;
    const priceText = priceVal > 0 ? "Rs. " + priceVal.toLocaleString("en-PK") : "Call for Price";
    const waMsg =
      "Salam Amir Hardware! Main order karna chahta hoon: " + p.title +
      (priceVal > 0 ? " - Rs. " + priceVal.toLocaleString("en-PK") : " - kindly price batayen.");
    const waText = encodeURIComponent(waMsg);

    return (
      '<article class="prem-card reveal">' +
      '<div class="product-card" style="background:#ffffff;border-radius:12px;overflow:hidden;position:relative;border:1px solid #e2e8f0;box-shadow:0 10px 25px rgba(0,0,0,0.05);">' +
      '<span style="position:absolute;top:12px;left:12px;background:#b0e6e6;color:#0f172a;padding:4px 10px;border-radius:20px;font-size:11px;font-weight:600;z-index:2;">' +
      String(cat).toUpperCase() + "</span>" +
      '<span style="position:absolute;top:12px;right:12px;' + stockBadge + 'padding:4px 10px;border-radius:20px;font-size:11px;font-weight:bold;z-index:2;">' +
      stockText + "</span>" +
      '<img src="' + img + '" alt="' + p.title + '" loading="lazy" onerror="this.src=' + "'" + PH_PLACEHOLDER.replace(/'/g, "&#39;") + "'" +
      '" style="width:100%;height:220px;object-fit:cover;display:block;" />' +
      '<div style="padding:20px;">' +
      '<h3 style="color:#0f172a;margin-bottom:8px;font-size:18px;">' + p.title + "</h3>" +
      (p.description
        ? '<p style="color:#334155;font-size:13px;line-height:1.5;margin-bottom:12px;">' + p.description + "</p>"
        : "") +
      '<p style="color:#c2410c;font-weight:800;font-size:1.05rem;margin:0 0 14px;">' + priceText + "</p>" +
      '<a href="https://wa.me/923007090124?text=' + waText + '" target="_blank" rel="noopener" ' +
      'style="display:flex;align-items:center;justify-content:center;gap:9px;background:#25d366;color:#fff;padding:12px 16px;border-radius:10px;font-size:0.95rem;font-weight:700;text-decoration:none;">' +
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style="width:18px;height:18px;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.497.1-.198.05-.371-.025-.52-.074-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" /></svg>' +
      "Order on WhatsApp \uD83D\uDCAC" +
      "</a>" +
      "</div></div></article>"
    );
  }

  function renderCatalogue(products) {
    premGrid.innerHTML = products.map(buildProductCard).join("");

    if (typeof revealObserver !== "undefined") {
      document.querySelectorAll("#prem-grid .reveal").forEach(function (el) {
        revealObserver.observe(el);
      });
    } else {
      document.querySelectorAll("#prem-grid .reveal").forEach(function (el) {
        el.classList.add("visible");
      });
    }
  }

  function showCatalogueStatus(msg, isError) {
    catalogueStatus.textContent = msg;
    catalogueStatus.hidden = false;
    catalogueStatus.classList.toggle("catalogue-error", !!isError);
  }

  fetch(API_BASE + "/api/products")
    .then(function (res) {
      if (!res.ok) throw new Error("Server responded with " + res.status);
      return res.json();
    })
    .then(function (products) {
      if (products && products.length) {
        renderCatalogue(products);
        showCatalogueStatus(
          products.length + " premium products loaded live from the catalogue.",
          false
        );
      } else {
        showCatalogueStatus("The admin catalogue is empty — add products from the dashboard.", false);
      }
    })
    .catch(function () {
      showCatalogueStatus(
        "Live catalogue offline — showing featured collection. Start the admin server with \"npm start\" to load uploaded products.",
        true
      );
    });
})();
