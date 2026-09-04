/* ============ GROCERY — storefront ============ */
const $ = id => document.getElementById(id);
let activeCat = "All", searchQ = "", sortBy = "featured", inStockOnly = false;
let vendor = catalogueViewer();

/* ---------- NAV (auth aware) ---------- */
function renderNav() {
  const el = $("navActions");
  if (isAdmin()) {
    el.innerHTML = `<a class="btn btn-ghost" href="admin.html">🛠 Admin Panel</a>
                    <button class="btn btn-primary" id="logoutBtn">Sign out</button>`;
  } else if (vendor) {
    el.innerHTML = `
      <a class="btn btn-ghost nav-cta" href="orderpad.html">⚡ Quick Order</a>
      <button class="icon-btn" id="cartBtn" aria-label="Order">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1.5"/><circle cx="19" cy="21" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.6L22 7H6"/></svg>
        <span class="badge accent" id="cartBadge">0</span>
      </button>
      <a class="btn btn-ghost nav-cta" href="vendor.html">Account</a>
      <button class="btn btn-primary" id="logoutBtn">Sign out</button>`;
  } else {
    el.innerHTML = `<a class="btn btn-ghost" href="login.html">Trade Login</a>
                    <a class="btn btn-primary nav-cta" href="#apply">Apply for Account</a>`;
  }
  if ($("logoutBtn")) $("logoutBtn").onclick = async () => { await logout(); toast("Signed out", "\u{1F44B}"); setTimeout(() => location.reload(), 400); };
  if ($("cartBtn")) $("cartBtn").onclick = () => { renderCart(); openDrawer(); };
  mountThemeToggle();   // nav-actions is rebuilt above, so re-attach the toggle
  syncBadge();
}

/* ---------- vendor view (item 1) ----------
   Signed in, the home page is the catalogue and nothing else: no hero, no
   marketing, no tier explainer. Signed out, the full landing page stays. */
function applyVendorView() {
  const on = !!vendor;
  document.querySelectorAll(".vendor-hide").forEach(el => { el.style.display = on ? "none" : ""; });
}

/* ---------- STATUS BANNER ---------- */
function renderBanner() {
  const el = $("statusBanner");
  if (vendor) {
    // Signed in, the nav already carries the account links; a banner repeating
    // them is just a strip between the customer and the products.
    el.innerHTML = "";
  } else {
    el.innerHTML = `<div class="banner lock">
      <span class="banner-ico">\u{1F512}</span>
      <div><b>Trade pricing is hidden</b>
      <small>We supply registered businesses only. Sign in to see prices and order online.</small></div>
      <div class="banner-actions"><a class="btn btn-ghost" href="login.html">Sign in</a><a class="btn btn-primary" href="#apply">Apply now</a></div></div>`;
  }
}



/* ---------- FILTERS ---------- */
/* Categories, with a live count of what is in each under the other filters. */
let catQuery = "";

function renderChips() {
  const host = $("sideCats");
  if (!host) return;

  // Counts reflect the search and stock filter, so a category showing 0 tells
  // you it holds nothing matching rather than nothing at all.
  const pool = getProducts().filter(p =>
    (searchQ === "" || (p.name + " " + p.sku + " " + p.cat).toLowerCase().includes(searchQ)) &&
    (!inStockOnly || p.stock > 0));

  const counts = {};
  pool.forEach(p => { counts[p.cat] = (counts[p.cat] || 0) + 1; });

  const cats = getCategories()
    .filter(c => c.name !== "All")
    .filter(c => !catQuery || c.name.toLowerCase().includes(catQuery))
    .map(c => ({ name: c.name, n: counts[c.name] || 0 }));

  host.innerHTML = [
    `<button class="side-cat ${activeCat === "All" ? "active" : ""}" data-cat="All">
       <span>All products</span><span class="n">${pool.length}</span></button>`,
    ...cats.map(c => `<button class="side-cat ${c.name === activeCat ? "active" : ""}" data-cat="${esc(c.name)}">
       <span>${esc(c.name)}</span><span class="n">${c.n}</span></button>`),
  ].join("");

  host.querySelectorAll(".side-cat").forEach(el => el.onclick = () => setCat(el.dataset.cat));
  if ($("clearCats")) $("clearCats").hidden = activeCat === "All";
}

/* A summary of what is narrowing the list, each removable. */
function renderActiveFilters() {
  const host = $("activeFilters");
  if (!host) return;
  const chips = [];
  if (activeCat !== "All") chips.push(["cat", activeCat]);
  if (searchQ) chips.push(["q", `"${searchQ}"`]);
  if (inStockOnly) chips.push(["stock", "In stock only"]);

  host.innerHTML = chips.map(([k, label]) =>
    `<span class="af-chip">${esc(label)}<button data-drop="${k}" aria-label="Remove">×</button></span>`).join("");

  host.querySelectorAll("[data-drop]").forEach(b => b.onclick = () => {
    const k = b.dataset.drop;
    if (k === "cat") activeCat = "All";
    if (k === "q") { searchQ = ""; if ($("sideSearch")) $("sideSearch").value = ""; if ($("searchInput")) $("searchInput").value = ""; }
    if (k === "stock") { inStockOnly = false; if ($("inStockOnly")) $("inStockOnly").checked = false; }
    renderChips(); renderProducts();
  });
}
function setCat(cat) { activeCat = cat; resetScroll(); renderChips(); renderProducts(); }

function visibleProducts() {
  const list = getProducts().filter(p =>
    (activeCat === "All" || p.cat === activeCat) &&
    (!inStockOnly || p.stock > 0) &&
    (searchQ === "" || (p.name + " " + p.sku + " " + p.cat).toLowerCase().includes(searchQ)));
  const sorters = {
    name: (a,b) => a.name.localeCompare(b.name),
    brand: (a,b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name),
    stock: (a,b) => b.stock - a.stock,
    featured: (a,b) => (b.flags.includes("best") - a.flags.includes("best")) || a.name.localeCompare(b.name),
  };
  return list.sort(sorters[sortBy]);
}

/* ---------- PRODUCTS ---------- */
/* ---------- quantity control (item 2) ----------
   Shows "Add" until the line is in the basket, then a −/qty/+ stepper.
   Capped at the cases actually on the shelf in the ERP. */
function qtyControl(p, out) {
  // Staff browse the shop to check how it looks; ordering needs a customer
  // account, so they get the price and the range but no basket.
  if (vendor?.staff) return `<span class="staff-only">Staff view</span>`;
  if (out) return `<span class="stock-out">Out of stock</span>`;
  const q = getCart()[p.id] || 0;
  if (!q) return `<button class="p-add" data-add="${p.id}">Add</button>`;
  return `<div class="qty" data-stepper="${p.id}">
      <button data-dec="${p.id}" aria-label="Decrease">\u2212</button>
      <b>${q}</b>
      <button data-inc="${p.id}" aria-label="Increase" ${q >= p.stock ? "disabled" : ""}>+</button>
    </div>`;
}

function priceBlock(p) {
  const pr = priceFor(p, vendor);
  if (!vendor) return `<div class="p-locked"><span class="lock-ico">\u{1F512}</span><div><b>Trade price</b><small>Sign in to view</small></div></div>`;
  if (!pr) return `<div class="p-locked"><span class="lock-ico">\u2014</span><div><b>Price on request</b><small>Contact our trade team</small></div></div>`;
  // The case size is already on the meta line above, so the figure needs no
  // caption — only what one unit inside the case works out at, and the offer
  // if this line is on one.
  const brk = nextBreak(p);
  return `<div class="p-price"><b>${money(pr.net)}</b>${unitPriceLine(p, pr)}${
    pr.volPct ? `<span class="p-save">${pr.volPct}% off applied</span>`
    : brk ? `<span class="p-save">${money(brk.net)} at ${brk.cases}+ cases</span>` : ""
  }</div>`;
}


/* Signed out, the home page shows a sample \u2014 three rows on a wide screen.
   Signed in, the whole range. */
const PREVIEW_COUNT = 12;
/* How many lines each category contributes to the home listing. Picking a
   category from the chips lifts the cap and shows that category in full. */
const PER_CATEGORY = 10;

/*
 * Endless scroll. Every product is on one page, but they are painted a screenful
 * at a time — putting 500 cards into the DOM at once locks the browser for
 * seconds, and nobody sees past the first twenty anyway.
 */
const PAGE = 60;
let shown = PAGE;

/* Takes the first n of each category, keeping the order the sort produced. */
function capPerCategory(list, n) {
  const seen = {};
  return list.filter(p => (seen[p.cat] = (seen[p.cat] || 0) + 1) <= n);
}

function renderProducts() {
  const all = visibleProducts();
  const previewing = !vendor && !searchQ && activeCat === "All";
  // The home listing is a sampler: a few lines from every category rather than
  // the whole catalogue in one wall. A search or a chosen category shows all.
  const sampling = !searchQ && activeCat === "All";
  // Signed out, the teaser stays a teaser — but drawn across categories now,
  // rather than the first dozen lines alphabetically.
  const full = previewing ? capPerCategory(all, PER_CATEGORY).slice(0, PREVIEW_COUNT) : all;
  const list = full.slice(0, shown);
  const lowAt = getSettings().lowStockAt;
  $("emptyState").hidden = list.length > 0;
  $("productsGrid").innerHTML = list.map((p, i) => {
    const flags = p.flags.map(f => f === "best" ? `<span class="flag best">★ BEST SELLER</span>` : `<span class="flag new">NEW</span>`).join("");
    // Stock on hand is a warehouse fact, not a buying restriction — a priced
    // line can be ordered whether or not cases are on the shelf today.
    const out = !p.priced, low = p.priced && p.stock > 0 && p.stock <= lowAt;
    return `<article class="p-card ${out ? "out" : ""}" style="animation-delay:${Math.min(i*35,400)}ms">
      <div class="p-media">${productMedia(p)}
        <div class="p-flags">${flags}${out ? `<span class="flag oos">PRICE ON REQUEST</span>` : ""}</div>
        <button class="p-quick" data-quick="${p.id}">👁 Quick View</button>
      </div>
      <div class="p-body">
        <span class="p-brand">${esc(p.cat)}</span>
        <h3 class="p-name">${esc(p.name)}</h3>
        <div class="p-meta">${esc(p.unit)}${p.size ? " · " + esc(p.size) : ""}${weightLabel(p) ? " · " + weightLabel(p) : ""}</div>
        ${out ? `<span class="stock-out">Price on request</span>` : ""}
        <div class="p-foot">
          ${priceBlock(p)}
          ${vendor ? qtyControl(p, out) : `<a class="p-add ghost" href="login.html">Sign in</a>`}
        </div>
      </div>
    </article>`;
  }).join("");

  document.querySelectorAll("[data-add]").forEach(el => el.onclick = () => addToCart(el.dataset.add, el));
  document.querySelectorAll("[data-inc]").forEach(el => el.onclick = () => bumpQty(el.dataset.inc, +1));
  document.querySelectorAll("[data-dec]").forEach(el => el.onclick = () => bumpQty(el.dataset.dec, -1));
  document.querySelectorAll("[data-quick]").forEach(el => el.onclick = () => openQuickView(el.dataset.quick));

  mountEndlessScroll(full.length, list.length);

  renderActiveFilters();
  if ($("resultCount")) {
    $("resultCount").textContent =
      all.length === full.length
        ? `${all.length} product${all.length === 1 ? "" : "s"}`
        : `${full.length} of ${all.length} shown`;
  }

  const more = $("previewMore");
  if (more) {
    if (previewing && all.length > list.length) {
      more.hidden = false;
      more.innerHTML =
        `<p>Showing ${list.length} of <b>${all.length}</b> lines.</p>
         <div class="preview-actions">
           <a class="btn btn-primary" href="login.html">Sign in to see the full range</a>
           <a class="btn btn-ghost" href="#apply">Apply for an account</a>
         </div>`;
    } else if (sampling && all.length > list.length) {
      // Signed in: say plainly that this is a sample and how to see a full one.
      more.hidden = false;
      more.innerHTML =
        `<p>Showing the first <b>${PER_CATEGORY}</b> lines of each category —
            ${list.length} of <b>${all.length}</b>. Pick a category above to see it in full.</p>`;
    } else {
      more.hidden = true;
    }
  }
}

/* ---------- QUICK VIEW ---------- */
/*
 * Product detail below the buy controls: what the line is, what is in it, and
 * the pack's own nutrition panel where one was supplied. Not every line in the
 * price list carries this copy, so each block only appears when it has content
 * and the section disappears entirely when none of them do.
 */
function productDetails(p) {
  const rows = [];
  if (p.ingredients) rows.push(["Ingredients", esc(p.ingredients)]);
  const spec = [p.size, p.unit, weightLabel(p), p.barcode].filter(Boolean).map(esc).join(" · ");
  if (spec) rows.push(["Pack", spec]);
  const panel = p.nutritionUrl
    ? `<div class="qv-nutri"><h4>Nutrition</h4><img src="${esc(p.nutritionUrl)}" alt="Nutrition information for ${esc(p.name)}" loading="lazy"></div>`
    : "";
  if (!rows.length && !panel) return "";
  return `<div class="qv-details">
      ${rows.map(([k, v]) => `<div class="qv-det"><h4>${k}</h4><p>${v}</p></div>`).join("")}
      ${panel}
    </div>`;
}

function openQuickView(id) {
  const p = getProduct(id);
  if (!p) return;
  const out = !p.priced;
  const render = q => {
    // Priced at the quantity on screen, so stepping up to a break shows it.
    const pr = priceFor(p, vendor, q);
    $("quickView").innerHTML = `
      <div class="qv">
        <div class="qv-media">${productMedia(p, "qv-pic")}</div>
        <div class="qv-body">
          <button class="close-btn qv-close" id="qvClose">\u2715</button>
          <span class="p-brand">${esc(p.cat)}</span>
          <h3>${esc(p.name)}</h3>
          <p class="qv-desc">${esc(p.description || p.desc)}</p>
          ${pr ? `<div class="qv-price"><b>${money(pr.net)}</b>${unitPriceLine(p, pr)}${nextBreak(p) ? `<span class="p-save">${money(nextBreak(p).net)} per case at ${nextBreak(p).cases}+</span>` : ""}</div>`
               : vendor ? `<div class="qv-locked">\u2014 <b>Price on request</b><small>Contact our trade team for a price on this line.</small></div>`
               : `<div class="qv-locked">\u{1F512} <b>Trade price hidden</b><small>Prices are available to approved wholesale accounts only.</small></div>`}
          <span class="qv-unit">${esc(p.unit)} \u00b7 ${out ? "out of stock" : p.stock + " cases in stock"}${p.barcode ? ` \u00b7 ${esc(p.barcode)}` : ""}</span>
          <div class="qv-tags"><span>\u2705 100% Certified</span><span>\u{1F69A} Free UK &amp; IE delivery</span><span>\u26A1 48h dispatch</span></div>
          ${productDetails(p)}
          <div class="qv-row">
            ${vendor?.staff ? `<span class="staff-only">Staff view \u2014 sign in as a customer to order</span>`
              : pr ? (out ? `<span class="stock-out">Out of stock \u2014 back soon</span>`
                   : `<div class="qty"><button id="qvDec">\u2212</button><b id="qvQty">${q}</b><button id="qvInc" ${q >= p.stock ? "disabled" : ""}>+</button></div>
                      <button class="btn btn-primary" id="qvAdd">Add ${q} to order <span class="arrow">\u2192</span></button>`)
                 : `<a class="btn btn-primary" href="login.html">Sign in <span class="arrow">\u2192</span></a>`}
          </div>
        </div>
      </div>`;
    $("qvClose").onclick = closeQuickView;
    if (pr && !out && !vendor?.staff) {
      $("qvDec").onclick = () => render(Math.max(1, q - 1));
      $("qvInc").onclick = () => render(Math.min(p.stock, q + 1));
      $("qvAdd").onclick = () => { addToCart(id, null, q); closeQuickView(); };
    }
  };
  render(1);
  $("quickViewOverlay").classList.add("open");
}
const closeQuickView = () => $("quickViewOverlay").classList.remove("open");
$("quickViewOverlay").onclick = e => { if (e.target === $("quickViewOverlay")) closeQuickView(); };

/* ---------- CART ---------- */
function syncBadge() { if ($("cartBadge")) $("cartBadge").textContent = cartCount(); }

function addToCart(id, btn, qty) {
  if (!vendor) { toast("Sign in to your trade account to order", "\u{1F512}"); return; }
  const p = getProduct(id);
  if (!p) return;
  const room = availableToAdd(p);
  if (room <= 0) { toast(`<b>${esc(p.name)}</b> \u2014 no more stock available`, "\u26A0\uFE0F"); return; }
  const want = Math.max(1, parseInt(qty, 10) || 1);   // one case; there is no MOQ
  const add = Math.min(want, room);
  const c = getCart();
  c[id] = (c[id] || 0) + add;
  saveCart(c); syncBadge(); renderCart(); renderProducts();
  toast(add < want ? `Only ${add} of ${want} added \u2014 stock limit reached`
                   : `<b>${esc(p.name)}</b> added to order`, add < want ? "\u26A0\uFE0F" : "\u{1F6D2}");
}
/** +/- on a product card. */
function bumpQty(id, delta) {
  const p = getProduct(id);
  if (!p) return;
  const next = (getCart()[id] || 0) + delta;
  setQty(id, next);
  renderProducts();
}

function setQty(id, q) {
  const c = getCart();
  const p = getProduct(id);
  q = parseInt(q, 10) || 0;
  if (q <= 0) delete c[id];
  else {
    if (p && q > p.stock) { q = p.stock; toast(`Only ${p.stock} cases in stock`, "\u26A0\uFE0F"); }
    c[id] = q;
  }
  saveCart(c); syncBadge(); renderCart();
}

function renderCart() {
  if (!vendor) return;
  const t = cartTotals(vendor);
  $("cartCount").textContent = t.lines.length ? `\u00b7 ${cartCount()} cases` : "";
  if (!t.lines.length) {
    $("cartItems").innerHTML = `<div class="cart-empty"><span>\u{1F6D2}</span><b>Your order is empty</b><p>Browse the range to add wholesale cases.</p></div>`;
    $("cartFoot").style.display = "none";
    return;
  }
  $("cartFoot").style.display = "";
  $("cartItems").innerHTML = t.lines.map(({ p, q, pr }) => `
    <div class="cart-item">
      <div class="ci-thumb">${productMedia(p)}</div>
      <div class="ci-info"><b>${esc(p.name)}</b>
        <small>${esc(p.unit)}${pr ? ` \u00b7 ${money(pr.net)} per case${unitEach(p, pr) === null ? "" : ` \u00b7 ${money(unitEach(p, pr))} per unit`}` : ""}</small>
        <span class="ci-price">${pr ? money(pr.net * q) : "\u2014"}</span></div>
      <div class="ci-right">
        <div class="qty"><button data-dec="${p.id}">\u2212</button><b>${q}</b><button data-inc="${p.id}" ${q >= p.stock ? "disabled" : ""}>+</button></div>
        <button class="ci-remove" data-rm="${p.id}">Remove</button>
      </div></div>`).join("");

  document.querySelectorAll("[data-dec]").forEach(el => el.onclick = () => { setQty(el.dataset.dec, (getCart()[el.dataset.dec] || 0) - 1); renderProducts(); });
  document.querySelectorAll("[data-inc]").forEach(el => el.onclick = () => { setQty(el.dataset.inc, (getCart()[el.dataset.inc] || 0) + 1); renderProducts(); });
  document.querySelectorAll("[data-rm]").forEach(el => el.onclick = () => { setQty(el.dataset.rm, 0); renderProducts(); toast("Removed from order", "\u{1F5D1}\uFE0F"); });

  $("cartNet").textContent = money(t.net);
}

const openDrawer = () => { $("drawerOverlay").classList.add("open"); $("cartDrawer").classList.add("open"); document.body.style.overflow = "hidden"; };
const closeDrawer = () => { $("drawerOverlay").classList.remove("open"); $("cartDrawer").classList.remove("open"); document.body.style.overflow = ""; };
$("closeCart").onclick = $("drawerOverlay").onclick = closeDrawer;

$("placeOrderBtn").onclick = async () => {
  const btn = $("placeOrderBtn");
  btn.disabled = true; btn.textContent = "Placing\u2026";
  const res = await submitOrder();
  btn.disabled = false; btn.innerHTML = `Place Order <span class="arrow">\u2192</span>`;
  if (!res.ok) { toast(esc(res.error), "\u26A0\uFE0F"); return; }

  closeDrawer(); syncBadge(); renderCart(); renderProducts();
  showMsg(`<span class="big">\u{1F389}</span><h3>Order placed</h3>
    <span class="order-no">${esc(res.number)}</span>
    <p>Invoice total <b>${money(res.grossPence / 100)}</b> including VAT of ${money(res.vatPence / 100)}.</p>
    <p>Payment due ${res.dueAt ? new Date(res.dueAt).toLocaleDateString("en-GB") : "on terms"}. We will pick and dispatch shortly.</p>
    <div class="msg-actions"><a class="btn btn-ghost" href="vendor.html">View my orders</a>
    <button class="btn btn-primary" data-close>Continue browsing</button></div>`);
  confetti();
};

/* ---------- APPLICATION FORM ---------- */
$("applyForm").onsubmit = async e => {
  e.preventDefault();
  const f = { name:$("ap-name"), shop:$("ap-shop"), email:$("ap-email"), phone:$("ap-phone"),
              address:$("ap-address"), postcode:$("ap-postcode") };
  let ok = true;
  Object.values(f).forEach(inp => { const bad = !inp.value.trim(); inp.classList.toggle("err", bad); if (bad) ok = false; });
  if (f.email.value && !/^\S+@\S+\.\S+$/.test(f.email.value)) { f.email.classList.add("err"); ok = false; }
  if (!ok) { toast("Please complete every required field with a valid email", "\u26A0\uFE0F"); return; }

  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true; btn.textContent = "Sending\u2026";
  const res = await registerVendor({
    name: f.name.value.trim(), shop: f.shop.value.trim(),
    email: f.email.value.trim(), phone: f.phone.value.trim(),
    addressLine: f.address.value.trim(),
    city: $("ap-city").value.trim(),
    postcode: f.postcode.value.trim(),
  });
  btn.disabled = false; btn.innerHTML = `Submit Application <span class="arrow">\u2192</span>`;

  if (!res.ok) { toast(esc(res.error), "\u26A0\uFE0F"); return; }
  e.target.reset();
  showMsg(`<span class="big">\u{1F4E8}</span><h3>Application received</h3>
    <span class="order-no">${esc(res.reference)}</span>
    <p>Thanks. Your application has gone to our trade team for approval.</p>
    <p>Once approved we will email you a password so you can sign in and see your prices.</p>
    <div class="msg-actions"><button class="btn btn-primary" data-close>Got it</button></div>`);
  confetti();
};

/* ---------- MESSAGE MODAL ---------- */
function showMsg(html) {
  $("msgModal").innerHTML = `<div class="co-success">${html}</div>`;
  $("msgOverlay").classList.add("open");
  $("msgModal").querySelectorAll("[data-close]").forEach(b => b.onclick = () => $("msgOverlay").classList.remove("open"));
}
$("msgOverlay").onclick = e => { if (e.target === $("msgOverlay")) $("msgOverlay").classList.remove("open"); };

function confetti() {
  const colors = ["#2bee7f","#b8ff5c","#00d4a0","#ffb24d","#ff5c7a"];
  for (let i = 0; i < 40; i++) {
    const c = document.createElement("div");
    c.style.cssText = `position:fixed;z-index:500;width:8px;height:8px;border-radius:2px;pointer-events:none;
      background:${colors[i % colors.length]};left:${50 + (Math.random()-0.5)*30}vw;top:40vh;
      transition:all ${1 + Math.random()}s cubic-bezier(.2,.6,.4,1);opacity:1`;
    document.body.appendChild(c);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      c.style.transform = `translate(${(Math.random()-0.5)*400}px,${300 + Math.random()*300}px) rotate(${Math.random()*720}deg)`;
      c.style.opacity = 0;
    }));
    setTimeout(() => c.remove(), 2400);
  }
}

/* ---------- SEARCH ---------- */
const searchInput = $("searchInput"), suggest = $("searchSuggest");
searchInput.oninput = () => {
  searchQ = searchInput.value.trim().toLowerCase();
  // Two search boxes, one state — keep the sidebar showing what is in force.
  if ($("sideSearch")) $("sideSearch").value = searchInput.value;
  renderChips();
  renderProducts();
  if (!searchQ) { suggest.classList.remove("open"); return; }
  const hits = visibleProducts().slice(0, 5);
  suggest.innerHTML = hits.length
    ? hits.map(p => { const pr = priceFor(p, vendor);
        return `<button data-sg="${p.id}">${p.emoji} ${esc(p.name)}<small>${pr ? money(pr.net) : "🔒"}</small></button>`; }).join("")
    : `<button disabled>No matches for "${esc(searchInput.value)}"</button>`;
  suggest.classList.add("open");
  suggest.querySelectorAll("[data-sg]").forEach(el => el.onclick = () => { openQuickView(el.dataset.sg); suggest.classList.remove("open"); });
};
document.addEventListener("click", e => { if (!$("navSearch").contains(e.target)) suggest.classList.remove("open"); });
$("sortSelect").onchange = e => { sortBy = e.target.value; resetScroll(); renderProducts(); };
$("clearFilters").onclick = () => { searchQ = ""; searchInput.value = ""; setCat("All"); };

/* ---------- SCROLL FX ---------- */
const revealObs = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add("in")), { threshold:.12 });
document.querySelectorAll(".reveal").forEach(el => revealObs.observe(el));

const counterObs = new IntersectionObserver(entries => entries.forEach(en => {
  if (!en.isIntersecting) return;
  const el = en.target, target = +el.dataset.count, t0 = performance.now();
  const anim = t => { const k = Math.min((t - t0) / 1400, 1); el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))) + "+"; if (k < 1) requestAnimationFrame(anim); };
  requestAnimationFrame(anim);
  counterObs.unobserve(el);
}), { threshold:.6 });
document.querySelectorAll("[data-count]").forEach(el => counterObs.observe(el));

setTimeout(() => document.querySelectorAll(".hero .reveal").forEach(el => el.classList.add("in")), 80);

addEventListener("scroll", () => {
  $("nav").classList.toggle("scrolled", scrollY > 10);
  $("backTop").classList.toggle("show", scrollY > 600);
});
$("backTop").onclick = () => scrollTo({ top:0, behavior:"smooth" });

const secObs = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  document.querySelectorAll(".nav-links a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + e.target.id));
}), { rootMargin:"-40% 0px -55% 0px" });
["top","catalogue","tiers","apply"].forEach(id => { const s = $(id); if (s) secObs.observe(s); });

$("hamburger").onclick = () => $("navLinks").classList.toggle("open");
document.querySelectorAll(".nav-links a").forEach(a => a.onclick = () => $("navLinks").classList.remove("open"));
addEventListener("keydown", e => { if (e.key === "Escape") { closeDrawer(); closeQuickView(); $("msgOverlay").classList.remove("open"); suggest.classList.remove("open"); } });


/* ---------- BANNER ---------- */
/*
 * Promotional banners across the top of the page. Add a file to assets/ and a
 * line to this list; the arrows, dots and auto-advance switch themselves on as
 * soon as there is more than one.
 */
const BANNERS = [
  { src: "assets/banner-1.jpg", alt: "Premium Indian food products — wholesale supplier in the UK", href: "#apply" },
];

let heroIdx = 0, heroTimer = null, heroCount = 0;

function renderHeroBanners() {
  const track = $("heroTrack"), dots = $("heroDots"), box = $("heroSlider");
  if (!track || !BANNERS.length) { if (box) box.closest(".banner-hero").hidden = true; return; }

  heroCount = BANNERS.length;
  box.classList.toggle("single", heroCount === 1);

  track.innerHTML = BANNERS.map(b => {
    const img = `<img src="${b.src}" alt="${esc(b.alt || "")}">`;
    return `<div class="slide">${b.href ? `<a href="${b.href}" style="display:block;width:100%">${img}</a>` : img}</div>`;
  }).join("");

  if (heroCount === 1) return;            // no controls needed for one banner

  dots.innerHTML = BANNERS.map((_, i) =>
    `<button type="button" aria-label="Banner ${i + 1}" data-i="${i}"></button>`).join("");
  dots.querySelectorAll("button").forEach(b =>
    b.onclick = () => { goHero(+b.dataset.i); restartHero(); });

  $("heroPrev").onclick = () => { goHero(heroIdx - 1); restartHero(); };
  $("heroNext").onclick = () => { goHero(heroIdx + 1); restartHero(); };

  // Pause while the pointer is over it, so nobody loses a banner mid-read.
  box.onmouseenter = () => clearInterval(heroTimer);
  box.onmouseleave = restartHero;

  goHero(0);
  restartHero();
}

function goHero(i) {
  if (!heroCount) return;
  heroIdx = (i + heroCount) % heroCount;
  $("heroTrack").style.transform = `translateX(-${heroIdx * 100}%)`;
  $("heroDots").querySelectorAll("button").forEach((b, n) =>
    b.setAttribute("aria-current", n === heroIdx ? "true" : "false"));
}

function restartHero() {
  clearInterval(heroTimer);
  if (heroCount > 1) heroTimer = setInterval(() => goHero(heroIdx + 1), 6000);
}

/* ---------- SHOP BY BRAND ---------- */
/*
 * A self-scrolling logo strip. Supplied artwork is used where we have it; any
 * other brand falls back to a lettermark so the strip never shows a gap.
 * Counts come from the live catalogue, so a brand we stop stocking drops out.
 */
const BRAND_LOGOS = {
  deep:      { label: "Deep",       src: "assets/brands/deep.png",      match: /^deep\b/i },
  haldirams: { label: "Haldiram's", src: "assets/brands/haldirams.svg", match: /haldiram/i },
  kurkure:   { label: "Kurkure",    src: "assets/brands/kurkure.png",   match: /kurkure/i },
  everest:   { label: "Everest",    src: "assets/brands/everest.png",   match: /everest/i },
  daawat:    { label: "Daawat",     src: "assets/brands/daawat.png",    match: /daawat/i },
  cocacola:  { label: "Coca-Cola",  src: "assets/brands/coca-cola.png", match: /coca[- ]?cola|thums up|sprite|fanta/i },
  lays:      { label: "Lay's",      src: "assets/brands/lays.png",      match: /^lays\b/i },
};


function renderBrands() {
  const track = $("brandTrack");
  if (!track) return;

  const products = getProducts();

  // Only brands we hold artwork for. A lettermark next to a real logo looks
  // like a missing image, so a brand without one simply is not in the strip.
  const tiles = Object.entries(BRAND_LOGOS).map(([key, b]) => ({
    key,
    name: b.label,
    query: b.label.replace(/[^A-Za-z]/g, ""),
    src: b.src,
    n: products.filter(p => b.match.test(p.name || "")).length,
  }));

  if (!tiles.length) { $("brandsSection").hidden = true; return; }

  const tileHtml = t => `
    <div class="brand-tile" data-brand="${esc(t.query)}" data-logo="${esc(t.key)}"
         role="button" tabindex="0" title="${esc(t.name)}${t.n ? ` — ${t.n} lines` : ""}">
      <img src="${t.src}" alt="${esc(t.name)}" loading="lazy">
    </div>`;

  // Rendered twice: the animation slides exactly half the track, so the second
  // copy is already in place when the first scrolls out.
  const half = tiles.map(tileHtml).join("");
  track.innerHTML = half + half;

  const search = q => {
    const box = $("searchInput");
    if (box) box.value = q;
    searchQ = q.toLowerCase();
    activeCat = "All";
    renderChips();
    renderProducts();
    document.getElementById("catalogue")?.scrollIntoView({ behavior: "smooth" });
  };
  track.querySelectorAll(".brand-tile").forEach(t => {
    t.onclick = () => search(t.dataset.brand);
    t.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); search(t.dataset.brand); } };
  });

  // Pace the loop by how much there is to scroll, so more brands does not mean
  // a faster strip. requestAnimationFrame does not fire in a hidden tab, so the
  // CSS duration stands as the fallback.
  requestAnimationFrame(() => {
    const w = track.scrollWidth / 2;
    if (w) track.style.animationDuration = `${Math.max(18, Math.round(w / 55))}s`;
  });
}

/* ---------- SIDEBAR CONTROLS ---------- */
function mountShopSidebar() {
  const side = $("sideSearch");
  if (side) {
    side.oninput = () => { searchQ = side.value.trim().toLowerCase(); resetScroll(); renderChips(); renderProducts(); };
  }
  if ($("catFilter")) {
    $("catFilter").oninput = e => { catQuery = e.target.value.trim().toLowerCase(); renderChips(); };
  }
  if ($("inStockOnly")) {
    $("inStockOnly").onchange = e => { inStockOnly = e.target.checked; resetScroll(); renderChips(); renderProducts(); };
  }
  if ($("clearCats")) {
    $("clearCats").onclick = () => setCat("All");
  }
  // On a narrow screen the sidebar folds away behind a button.
  if ($("filterToggle")) {
    $("filterToggle").onclick = () => {
      const open = $("shopSide").classList.toggle("open");
      $("filterToggle").setAttribute("aria-expanded", String(open));
    };
  }
}

/* ---------- INIT ---------- */
async function boot() {
  mountLogos();
  await loadSession();          // who is signed in, according to the ERP
  vendor = catalogueViewer();
  renderNav();
  await loadCatalogue();
  mountLogos();                 // now that the catalogue has told us the logo
  if (!CATALOGUE.loaded) {
    $("productsGrid").innerHTML = "";
    $("emptyState").hidden = false;
    $("emptyState").innerHTML = `<span>\u26A0\uFE0F</span><h3>Catalogue unavailable</h3>
      <p>Could not reach the warehouse system at ${esc(ERP_BASE)}.<br>
      <small class="muted">${esc(CATALOGUE.error || "")}</small></p>`;
    applyVendorView();
    renderBanner();
    return;
  }
  applyVendorView();
  renderBanner();
  renderChips();
  renderProducts();
  renderHeroBanners();
  renderBrands();
  mountShopSidebar();
  renderCart();
}
boot();


/** Pack weight, in the unit that reads best for the size. */
function weightLabel(p) {
  const g = p.weightGrams;
  if (!g) return "";
  return g >= 1000 ? `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 2)}kg` : `${g}g`;
}

/* ---------- ENDLESS SCROLL ---------- */
let scrollObserver = null;

/**
 * Paints the next screenful when the sentinel below the grid comes into view.
 * Any change of filter resets the window, so a narrowed list never starts
 * halfway down.
 */
function mountEndlessScroll(total, painted) {
  const grid = $("productsGrid");
  if (!grid) return;

  const old = $("scrollSentinel");
  if (old) old.remove();
  if (scrollObserver) { scrollObserver.disconnect(); scrollObserver = null; }
  if (painted >= total) return;

  const more = () => { shown += PAGE; renderProducts(); };

  // A button, not just a marker. Scrolling loads the next page on its own, but
  // if the observer never fires — a hidden tab, an old browser, reduced motion
  // settings — the rest of the range still has to be reachable.
  const sentinel = document.createElement("button");
  sentinel.id = "scrollSentinel";
  sentinel.type = "button";
  sentinel.className = "scroll-sentinel";
  sentinel.innerHTML =
    `<span class="spinner"></span> Showing ${painted} of ${total} — load more`;
  sentinel.onclick = more;
  grid.after(sentinel);

  scrollObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) more();
  }, { rootMargin: "600px" });
  scrollObserver.observe(sentinel);
}

/** Any change to what is being shown starts the window again. */
function resetScroll() { shown = PAGE; }
