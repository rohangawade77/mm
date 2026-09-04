/* ==========================================================
   GROCERY — shared data layer

   Nothing about the catalogue, an account or an order is stored in this
   browser. Products, customers, prices, orders and invoices all live in the
   Warehouse ERP; this file is the client that talks to it. The only things
   kept locally are the session token, the basket, and the theme choice.
   ========================================================== */

/*
 * Where the ERP is served from.
 *
 * The site is static, so this is the one setting that has to change when it is
 * hosted: every price, product and order comes from the ERP, and a hosted page
 * cannot reach a localhost address on someone else's machine. Put the ERP's
 * public hostname in ERP_PUBLIC below.
 *
 * Served from localhost, it keeps talking to the local ERP, so development is
 * unaffected. A `grc-erp-base` key in localStorage overrides both, which is how
 * you point a hosted build at a different ERP without editing anything.
 */
const ERP_PUBLIC = "";   // e.g. "https://erp.yourcompany.com" — leave blank until the ERP has a hostname

const LOCAL_HOSTS = ["localhost", "127.0.0.1", ""];
const ERP_BASE =
  localStorage.getItem("grc-erp-base")
  || (LOCAL_HOSTS.includes(location.hostname) ? "http://localhost:3007" : ERP_PUBLIC)
  || "http://localhost:3007";

const TOKEN_KEY = "grc-token";
const STAFF_KEY = "grc-staff";
const THEME_KEY = "grc-theme";
const CART_KEY  = "grc-basket";

/* ---------------------------------------------------------------- helpers */

const money = n => "£" + Number(n).toFixed(2);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

function toast(msg, icon = "✅") {
  let wrap = document.getElementById("toasts");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "toasts"; wrap.className = "toasts";
    document.body.appendChild(wrap);
  }
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = `<span>${icon}</span> ${msg}`;
  wrap.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 350); }, 2600);
}

/* Display-only settings. Anything that affects money is decided by the ERP. */
const getSettings = () => ({ lowStockAt: 20 });

/* ------------------------------------------------------------------- API */

let SESSION = { token: localStorage.getItem(TOKEN_KEY) || null, customer: null };

const authHeaders = () => ({
  "Content-Type": "application/json",
  ...(SESSION.token ? { Authorization: `Bearer ${SESSION.token}` } : {}),
});

async function api(path, options = {}) {
  try {
    const res = await fetch(`${ERP_BASE}/api/shop${path}`, { headers: authHeaders(), ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `Request failed (${res.status})` };
    return data;
  } catch {
    return { ok: false, error: "Could not reach the warehouse system." };
  }
}

/* --------------------------------------------------------------- catalogue */

let CATALOGUE = {
  loaded: false, error: null,
  company: "GROCERY", logoUrl: null, logoHeight: 40, categories: [], items: [],
  promotions: [],
};

/** Maps an ERP catalogue row onto the shape the storefront renders. */
function fromErp(row) {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    cat: row.category,
    categoryId: row.categoryId,
    // The ERP has no minimum order quantity, so every line starts at one case.
    moq: 1,
    size: row.size || "",
    unit: row.unitsPerCase > 1 ? `Case of ${row.unitsPerCase}` : "Single",
    unitsPerCase: row.unitsPerCase,
    weightGrams: row.weightGrams || null,
    stock: row.stockCases,
    barcode: row.barcode || "",
    priced: row.priced,
    tierCasePence: row.tierCasePence,
    defaultCasePence: row.defaultCasePence,
    img: row.imageUrl || null,
    emoji: "📦",
    // What the product actually is, where the price list said so; the size and
    // category are the fallback for lines that carry no copy.
    description: row.description || "",
    ingredients: row.ingredients || "",
    nutritionUrl: row.nutritionUrl || null,
    desc: [row.size, row.category].filter(Boolean).join(" · "),
    flags: [],
  };
}

/** Pulls the catalogue. Each page calls this once before it renders. */
async function loadCatalogue() {
  try {
    const res = await fetch(`${ERP_BASE}/api/shop/catalogue`, { cache: "no-store" });
    if (!res.ok) throw new Error(`the warehouse system returned ${res.status}`);
    const d = await res.json();
    CATALOGUE = {
      loaded: true, error: null,
      company: d.company,
      logoUrl: d.logoUrl || null,
      logoHeight: Number(d.logoHeight) || 40,
      categories: d.categories.map(c => c.name),
      items: d.items.map(fromErp),
      // An older ERP that predates offers simply sends none.
      promotions: Array.isArray(d.promotions) ? d.promotions : [],
    };
  } catch (err) {
    CATALOGUE = { ...CATALOGUE, loaded: false, error: String(err.message || err) };
  }
  return CATALOGUE;
}

const getProducts = () => CATALOGUE.items;
const getProduct = id => CATALOGUE.items.find(p => String(p.id) === String(id));
const getCategories = () => [{ name: "All" }, ...CATALOGUE.categories.map(name => ({ name }))];

function findByBarcode(code) {
  const c = String(code).trim();
  return CATALOGUE.items.find(p => p.barcode && String(p.barcode).trim() === c);
}

/* ------------------------------------------------------- trade accounts */

/** Resolves the stored token into a customer. Returns null when signed out. */
async function loadSession() {
  if (!SESSION.token) { SESSION.customer = null; return null; }
  const res = await api("/me");
  if (res.ok) {
    SESSION.customer = res.customer;
  } else {
    SESSION = { token: null, customer: null };
    localStorage.removeItem(TOKEN_KEY);
  }
  return SESSION.customer;
}

const currentVendor = () => SESSION.customer;

/*
 * Who the catalogue should render for. Staff have no trade account, so they
 * would otherwise browse the shop with every price hidden and only the signed
 * out preview of the range. They get the untiered price — the same figure an
 * approved account with no tier would see — and are marked `staff` so the buy
 * controls can stand down; ordering still needs a real customer token.
 */
function catalogueViewer() {
  const c = currentVendor();
  if (c) return c;
  if (isAdmin() || isWarehouse()) {
    return { staff: true, tier: null, name: isAdmin() ? "Admin" : "Warehouse", shopName: "Staff view" };
  }
  return null;
}

async function registerVendor({ name, shop, email, phone, addressLine, city, postcode }) {
  return api("/register", {
    method: "POST",
    body: JSON.stringify({ contactName: name, shopName: shop, email, phone, addressLine, city, postcode }),
  });
}

async function loginVendor(email, password) {
  const res = await api("/login", { method: "POST", body: JSON.stringify({ email, password }) });
  if (!res.ok) return res;
  SESSION = { token: res.token, customer: res.customer };
  localStorage.setItem(TOKEN_KEY, res.token);
  return { ok: true, vendor: res.customer };
}

async function changeMyPassword(current, next) {
  return api("/password", { method: "POST", body: JSON.stringify({ current, next }) });
}

async function logout() {
  if (SESSION.token) await api("/logout", { method: "POST" });
  SESSION = { token: null, customer: null };
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(STAFF_KEY);
}

/* ---- staff gates -------------------------------------------------------
   Staff do their work in the ERP; these only decide whether to hand over. */

const STAFF = {
  admin:     { email: "admin@grocery.com",     pass: "admin@123" },
  warehouse: { email: "warehouse@grocery.com", pass: "pack@123"  },
};

function signInStaff(role, email, password) {
  const want = STAFF[role];
  if (email.trim().toLowerCase() !== want.email || password.trim() !== want.pass)
    return { ok: false, error: "Those details are not right." };
  localStorage.setItem(STAFF_KEY, role);
  return { ok: true, role };
}
const loginAdmin     = (e, p) => signInStaff("admin", e, p);
const loginWarehouse = (e, p) => signInStaff("warehouse", e, p);
const isAdmin        = () => localStorage.getItem(STAFF_KEY) === "admin";
const isWarehouse    = () => localStorage.getItem(STAFF_KEY) === "warehouse";

/** Pages resolve the session in their own boot, so this is a no-op guard. */
function requireVendor() {}

/* ----------------------------------------------------------------- pricing */

/** Does this offer cover the product and tier in front of us? */
function promoCovers(promo, product, tier) {
  if (promo.tier && promo.tier !== tier) return false;
  if (promo.scope === "PRODUCT") return promo.productId === product.id;
  if (promo.scope === "CATEGORY") return promo.categoryId === product.categoryId;
  return true;                                        // ALL
}

/**
 * The best offer this line qualifies for, mirroring bestPromotionFor() in the
 * ERP so the website quotes what the invoice will actually charge. Breaks are
 * judged per line — ten cases of one product earns it, one case of ten
 * different products does not — and the customer gets the better of two
 * offers, never both.
 */
function bestPromo(product, qtyCases, tier, casePence) {
  let best = null, bestSaving = 0;
  for (const p of CATALOGUE.promotions) {
    if (qtyCases < p.minCases) continue;
    if (!promoCovers(p, product, tier)) continue;
    let saving = 0, applied = null;
    if (p.kind === "PERCENT" && p.percent > 0) {
      saving = casePence * qtyCases * (p.percent / 100);
      applied = { name: p.name, percent: p.percent, casePence: null };
    } else if (p.kind === "FIXED" && p.pricePence > 0 && p.pricePence < casePence) {
      saving = (casePence - p.pricePence) * qtyCases;
      applied = { name: p.name, percent: 0, casePence: p.pricePence };
    }
    if (applied && saving > bestSaving) { best = applied; bestSaving = saving; }
  }
  return best;
}

/**
 * What this customer pays for one case at this quantity. The ERP has already
 * worked the tier figure out from cost plus their markup, so there is nothing
 * to calculate here and no cost price in the browser to leak; quantity breaks
 * are then applied on top.
 *
 * Returns `list` (before any offer) alongside `net` so a saving can be shown.
 */
function priceFor(product, vendor = currentVendor(), qtyCases = 1) {
  if (!vendor || !product || !product.priced) return null;
  const pence = vendor.tier ? product.tierCasePence?.[vendor.tier] : product.defaultCasePence;
  if (pence === undefined || pence === null) return null;
  const list = pence / 100;
  const offer = bestPromo(product, Math.max(1, Number(qtyCases) || 1), vendor.tier ?? null, pence);
  if (!offer) return { net: list, list, volPct: 0, promoName: null };
  const net = offer.casePence !== null ? offer.casePence / 100 : list * (1 - offer.percent / 100);
  return { net, list, volPct: offer.percent, promoName: offer.name };
}

/** The cheapest quantity that unlocks a better price, for a "buy N and save" hint. */
function nextBreak(product, vendor = currentVendor()) {
  if (!vendor || !product?.priced) return null;
  const now = priceFor(product, vendor, 1);
  if (!now) return null;
  const mins = [...new Set(CATALOGUE.promotions.map(p => p.minCases).filter(m => m > 1))].sort((a, b) => a - b);
  for (const m of mins) {
    const then = priceFor(product, vendor, m);
    if (then && then.net < now.net - 0.005) return { cases: m, net: then.net, pct: then.volPct };
  }
  return null;
}

/*
 * Buyers compare lines on the single unit even though they order by the case,
 * so the case price is divided down for them. Singles have nothing to divide.
 */
function unitEach(product, pr) {
  const per = Number(product?.unitsPerCase) || 1;
  if (!pr || per <= 1) return null;
  return pr.net / per;
}
function unitPriceLine(product, pr) {
  const each = unitEach(product, pr);
  return each === null ? "" : `<span class="p-each">${money(each)} per unit</span>`;
}

/* ------------------------------------------------------------------ basket */

function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || "{}"); } catch { return {}; }
}
function saveCart(c) {
  const clean = Object.fromEntries(Object.entries(c).filter(([, q]) => Number(q) > 0));
  localStorage.setItem(CART_KEY, JSON.stringify(clean));
}
function cartLines() {
  const c = getCart(), products = getProducts();
  return Object.entries(c)
    .map(([id, q]) => ({ p: products.find(p => String(p.id) === String(id)), q: Number(q) }))
    .filter(l => l.p && l.q > 0);
}
const cartCount = () => cartLines().reduce((s, l) => s + l.q, 0);

function cartTotals(vendor = currentVendor()) {
  // Each line is priced at its own quantity, or the basket would quote the
  // one-case price while the ERP invoices the quantity break.
  const lines = cartLines().map(l => ({ ...l, pr: priceFor(l.p, vendor, l.q) }));
  const net = lines.reduce((s, l) => s + (l.pr ? l.pr.net : 0) * l.q, 0);
  const list = lines.reduce((s, l) => s + (l.pr ? l.pr.list : 0) * l.q, 0);
  return { lines, net, list, discount: list - net };
}

/** Cases of this product that can still be added, given what is already in. */
const availableToAdd = p => Math.max(0, (p?.stock ?? 0) - (getCart()[p?.id] || 0));

/* ------------------------------------------------------------------ orders */

/** Places the basket. The ERP prices it again and raises the invoice. */
async function submitOrder(note = "") {
  const lines = cartLines().map(l => ({ productId: l.p.id, cases: l.q }));
  if (!lines.length) return { ok: false, error: "Your order is empty." };
  const res = await api("/orders", { method: "POST", body: JSON.stringify({ lines, notes: note }) });
  if (res.ok) saveCart({});
  return res;
}

/**
 * A link to one of the customer's own documents. The token rides in the query
 * because a plain link cannot carry a header; the endpoint still checks the
 * document belongs to whoever the token identifies.
 */
function documentUrl(docId) {
  return `${ERP_BASE}/api/shop/document/${encodeURIComponent(docId)}?t=${encodeURIComponent(SESSION.token || "")}`;
}

/** The customer's delivery address. */
async function myAddress() { return api("/address"); }

/** Saves a new delivery address for the signed-in customer. */
async function saveMyAddress(addr) {
  return api("/address", { method: "POST", body: JSON.stringify(addr) });
}

/** What can still be sent back off one order, and why. */
async function returnableFor(docId) {
  return api(`/returns?docId=${encodeURIComponent(docId)}`);
}

/** Raises a return request for the signed-in customer. */
async function requestReturn(payload) {
  return api("/returns", { method: "POST", body: JSON.stringify(payload) });
}

/** The customer's own return history. */
async function myReturns() {
  const r = await api("/returns");
  return r.ok ? r.returns : [];
}

async function myOrders() {
  const res = await api("/orders");
  return res.ok ? res.orders : [];
}

/* --------------------------------------------------------------- branding */

const LOGO_SVG = `
<svg class="logo-svg" viewBox="0 0 264 72" role="img" aria-label="GROCERY">
  <defs>
    <linearGradient id="gMark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#10b981"/><stop offset="60%" stop-color="#059669"/><stop offset="100%" stop-color="#047857"/>
    </linearGradient>
  </defs>
  <rect x="4" y="6" width="60" height="60" rx="16" fill="url(#gMark)"/>
  <path d="M26 31.5c0-5.6 3.6-9.6 8-9.6s8 4 8 9.6" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/>
  <path d="M19 33.5h30l-3.3 16.6a3.4 3.4 0 0 1-3.3 2.7H25.6a3.4 3.4 0 0 1-3.3-2.7z" fill="#fff"/>
  <path d="M29.6 39.2v8.2M38.4 39.2v8.2" stroke="#059669" stroke-width="2.4" stroke-linecap="round"/>
  <text x="78" y="43" font-family="'Space Grotesk',system-ui,sans-serif" font-size="27" font-weight="700" fill="currentColor" letter-spacing="0.4">GROCERY</text>
  <text x="79" y="57" font-family="Inter,system-ui,sans-serif" font-size="8" font-weight="600" fill="#8d9d96" letter-spacing="2.6">WHOLESALE · B2B ONLY</text>
</svg>`;

/**
 * Uses the logo uploaded in the warehouse system's Settings if there is one,
 * and falls back to the built-in wordmark otherwise. The catalogue call
 * carries it, so a logo changed in the back office lands here on next load.
 */
function mountLogos() {
  const url = CATALOGUE.logoUrl;
  const html = url
    ? `<img class="logo-img" style="height:${CATALOGUE.logoHeight}px"
            src="${url.startsWith("http") ? url : ERP_BASE + url}"
            alt="${esc(CATALOGUE.company || "Home")}">`
    : LOGO_SVG;
  document.querySelectorAll("[data-logo]").forEach(el => el.innerHTML = html);
  mountThemeToggle();
}

/**
 * Product thumbnail. Real photo when there is one, otherwise a generated
 * placeholder built from the product's own initials and a colour derived from
 * its name, so an unphotographed catalogue still looks deliberate rather than
 * broken. onerror covers a photo that has since been deleted on the server.
 */
function placeholderFor(p) {
  const label = (p?.name || "?")
    .replace(/[^a-z0-9 ]/gi, "")
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join("") || "?";
  let h = 0;
  for (const ch of String(p?.name || "")) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="p-placeholder" style="--ph-hue:${h}"><b>${esc(label)}</b></span>`;
}

const productMedia = (p, cls = "") =>
  p?.img
    ? `<img class="p-img ${cls}" src="${p.img}" alt="${esc(p.name)}" loading="lazy"
            onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'p-placeholder',innerHTML:'<b>?</b>'}))">`
    : placeholderFor(p);

/* ------------------------------------------------------------------- theme */

const systemTheme = () => matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
const activeTheme = () => localStorage.getItem(THEME_KEY) || systemTheme();

function setTheme(t) {
  localStorage.setItem(THEME_KEY, t);
  document.documentElement.dataset.theme = t;
  paintThemeToggles();
}
function toggleTheme() {
  const next = activeTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  toast(next === "dark" ? "Dark theme on" : "Light theme on", next === "dark" ? "🌙" : "☀️");
}
function paintThemeToggles() {
  const dark = activeTheme() === "dark";
  document.querySelectorAll(".theme-btn").forEach(b => {
    b.innerHTML = dark ? "☀️" : "🌙";
    b.title = dark ? "Switch to light theme" : "Switch to dark theme";
    b.setAttribute("aria-label", b.title);
  });
}
function mountThemeToggle() {
  document.documentElement.dataset.theme = activeTheme();
  [".nav-actions", ".app-bar-right", ".auth-wrap"].forEach(sel => {
    document.querySelectorAll(sel).forEach(host => {
      if (host.querySelector(".theme-btn")) return;
      const b = document.createElement("button");
      b.className = "icon-btn theme-btn" + (sel === ".auth-wrap" ? " floating" : "");
      b.onclick = toggleTheme;
      host.prepend(b);
    });
  });
  paintThemeToggles();
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (!localStorage.getItem(THEME_KEY)) {
    document.documentElement.dataset.theme = systemTheme();
    paintThemeToggles();
  }
});
