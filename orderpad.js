/* ============ GROCERY — quick order pad ============
   Keyboard-first bulk entry: type a few letters or scan a barcode,
   Enter to pick, type quantity, Enter again to jump to a new row.  */
requireVendor();
const $ = id => document.getElementById(id);
mountLogos();

let vendor = currentVendor();
let RECENT_ORDERS = [];
$("roleChip").textContent = "TRADE ACCOUNT";
$("roleChip").className = "role-chip";
$("logoutBtn").onclick = () => { logout(); location.href = "index.html"; };

/* rows: {key, productId, qty} */
let rows = [{ key: 1, productId: null, qty: null }];
let nextKey = 2;
let activeSuggest = null;

const rowProduct = r => (r.productId ? getProduct(r.productId) : null);

function padTotals() {
  let gross = 0, net = 0, cases = 0;
  rows.forEach(r => {
    const p = rowProduct(r);
    if (!p || !r.qty) return;
    const pr = priceFor(p, vendor, r.qty);
    if (!pr) return;
    // "List" is this customer's own tier price before any quantity break, so
    // the saving shown is the break itself and never a tier markup.
    gross += pr.list * r.qty; net += pr.net * r.qty; cases += r.qty;
  });
  return { gross, net, discount: gross - net, cases, filled: rows.filter(r => rowProduct(r) && r.qty).length };
}

function render() {
  const t = padTotals();
  const recent = RECENT_ORDERS.slice(0, 4);

  $("padMain").innerHTML = `
    <div class="page-head">
      <h1>Quick Order Pad</h1>
      <p>Type a product name, code or barcode and press <kbd>Enter</kbd>. Enter the quantity, then <kbd>Enter</kbd> again for the next line.</p>
    </div>

    ${recent.length ? `<section class="panel">
      <div class="panel-head"><h2>Reorder a previous order</h2>
        <a class="btn btn-ghost sm" href="vendor.html">All orders</a></div>
      <div class="reorder-strip">
        ${recent.map(o => `<button class="reorder-card" data-reorder="${esc(o.number)}">
          <b>${esc(o.number)}</b>
          <small>${new Date(o.issuedAt).toLocaleDateString("en-GB")} \u00b7 ${o.lines.reduce((s,l)=>s+l.qtyCases,0)} cases</small>
          <span class="reorder-cta">↻ Load into pad</span>
        </button>`).join("")}
      </div>
    </section>` : ""}

    <section class="panel pad-panel">
      <div class="panel-head">
        <h2>Order lines</h2>
        <div class="pad-actions">
          <button class="btn btn-ghost sm" id="clearPad">Clear</button>
          <button class="btn btn-ghost sm" id="addRow">＋ Add line</button>
        </div>
      </div>

      <div class="pad-head">
        <span>Product</span><span>Pack</span><span class="ta-r">Stock</span>
        <span class="ta-r">Unit price</span><span class="ta-c">Qty</span><span class="ta-r">Line total</span><span></span>
      </div>
      <div id="padRows">${rows.map(rowHtml).join("")}</div>

      <div class="pad-foot">
        <div class="pad-totals">
          <div><span>Lines</span><b>${t.filled}</b></div>
          <div><span>Cases</span><b>${t.cases}</b></div>
          <div><span>List total</span><b>${money(t.gross)}</b></div>
          <div class="save"><span>You save</span><b>−${money(t.discount)}</b></div>
          <div class="grand"><span>Order total</span><b>${money(t.net)}</b></div>
        </div>
        <button class="btn btn-primary btn-lg" id="addAll" ${t.filled ? "" : "disabled"}>
          Add ${t.filled || ""} line${t.filled === 1 ? "" : "s"} to order <span class="arrow">→</span>
        </button>
      </div>
    </section>`;

  wire();
}

function rowHtml(r, i) {
  const p = rowProduct(r);
  const pr = p ? priceFor(p, vendor, r.qty || 1) : null;
  const over = p && r.qty > p.stock;
  return `<div class="pad-row ${p ? "filled" : ""} ${over ? "over" : ""}" data-key="${r.key}">
    <div class="pad-cell pad-search">
      <input class="pad-input" data-find="${r.key}" placeholder="Search or scan…" autocomplete="off"
             value="${p ? esc(p.name) : ""}">
      <div class="pad-suggest" data-sg="${r.key}"></div>
    </div>
    <div class="pad-cell muted">${p ? esc(p.unit) : "—"}</div>
    <div class="pad-cell ta-r">${p ? (p.stock ? `<span class="${p.stock <= 20 ? "low" : ""}">${p.stock}</span>` : `<span class="oos">Out</span>`) : "—"}</div>
    <div class="pad-cell ta-r">${pr ? `<b>${money(pr.net)}</b>${pr.volPct ? `<small class="vol">−${pr.volPct}% vol</small>` : ""}${unitEach(p, pr) === null ? "" : `<small class="each">${money(unitEach(p, pr))}/unit</small>`}` : "—"}</div>
    <div class="pad-cell ta-c">
      <input class="pad-qty" type="number" min="0" data-qty="${r.key}" value="${r.qty ?? ""}"
             placeholder="${p ? p.moq : "0"}" ${p ? "" : "disabled"}>
    </div>
    <div class="pad-cell ta-r"><b>${p && r.qty ? money(pr.net * r.qty) : "—"}</b></div>
    <div class="pad-cell ta-c"><button class="pad-del" data-del="${r.key}" title="Remove line">✕</button></div>
    ${over ? `<div class="pad-warn">Only ${p.stock} in stock — quantity reduced on adding.</div>` : ""}
  </div>`;
}

/* ---------------- interaction ---------------- */
function wire() {
  $("addRow").onclick = () => { rows.push({ key: nextKey++, productId: null, qty: null }); render(); focusRow(rows.at(-1).key); };
  $("clearPad").onclick = () => { rows = [{ key: nextKey++, productId: null, qty: null }]; render(); };
  $("addAll").onclick = addAllToCart;

  document.querySelectorAll("[data-reorder]").forEach(b => b.onclick = () => loadOrderIntoPad(b.dataset.reorder));
  document.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
    rows = rows.filter(r => r.key !== +b.dataset.del);
    if (!rows.length) rows = [{ key: nextKey++, productId: null, qty: null }];
    render();
  });

  document.querySelectorAll("[data-find]").forEach(inp => {
    const key = +inp.dataset.find;
    inp.oninput = () => showSuggest(key, inp.value);
    inp.onkeydown = e => handleSearchKey(e, key, inp);
    inp.onfocus = () => { if (inp.value.trim()) showSuggest(key, inp.value); };
    inp.onblur = () => setTimeout(() => hideSuggest(key), 160);
  });

  document.querySelectorAll("[data-qty]").forEach(inp => {
    const key = +inp.dataset.qty;
    inp.onchange = inp.oninput = () => {
      const r = rows.find(r => r.key === key);
      r.qty = inp.value === "" ? null : Math.max(0, parseInt(inp.value, 10) || 0);
      updateTotalsOnly();
    };
    inp.onkeydown = e => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const r = rows.find(r => r.key === key);
      const p = rowProduct(r);
      if (p && !r.qty) { r.qty = p.moq; }
      const last = rows.at(-1);
      if (last.key === key || !last.productId) {
        if (last.key === key) rows.push({ key: nextKey++, productId: null, qty: null });
        render(); focusRow(rows.at(-1).key);
      } else { render(); focusRow(last.key); }
    };
  });
}

/* Re-renders only the totals so typing a quantity doesn't steal focus. */
function updateTotalsOnly() {
  const t = padTotals();
  const foot = document.querySelector(".pad-totals");
  if (!foot) return render();
  foot.innerHTML = `
    <div><span>Lines</span><b>${t.filled}</b></div>
    <div><span>Cases</span><b>${t.cases}</b></div>
    <div><span>List total</span><b>${money(t.gross)}</b></div>
    <div class="save"><span>You save</span><b>−${money(t.discount)}</b></div>
    <div class="grand"><span>Order total</span><b>${money(t.net)}</b></div>`;
  const btn = $("addAll");
  btn.disabled = !t.filled;
  btn.innerHTML = `Add ${t.filled || ""} line${t.filled === 1 ? "" : "s"} to order <span class="arrow">→</span>`;
  // keep each row's own line total honest
  rows.forEach(r => {
    const p = rowProduct(r);
    const el = document.querySelector(`.pad-row[data-key="${r.key}"]`);
    if (!el || !p) return;
    const pr = priceFor(p, vendor, r.qty || 1);
    el.querySelectorAll(".pad-cell")[3].innerHTML = `<b>${money(pr.net)}</b>${pr.volPct ? `<small class="vol">−${pr.volPct}% vol</small>` : ""}${unitEach(p, pr) === null ? "" : `<small class="each">${money(unitEach(p, pr))}/unit</small>`}`;
    el.querySelectorAll(".pad-cell")[5].innerHTML = `<b>${r.qty ? money(pr.net * r.qty) : "—"}</b>`;
    const over = r.qty > p.stock;
    el.classList.toggle("over", over);
    let warn = el.querySelector(".pad-warn");
    if (over && !warn) {
      warn = document.createElement("div");
      warn.className = "pad-warn";
      el.appendChild(warn);
    }
    if (warn) {
      if (over) warn.textContent = `Only ${p.stock} in stock — quantity reduced on adding.`;
      else warn.remove();
    }
  });
}

function matches(q) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  const exact = findByBarcode(s);
  if (exact) return [exact];
  return getProducts()
    .filter(p => (p.name + " " + p.brand + " " + p.cat + " " + (p.barcode || "")).toLowerCase().includes(s))
    .slice(0, 7);
}

function showSuggest(key, q) {
  const box = document.querySelector(`[data-sg="${key}"]`);
  const hits = matches(q);
  activeSuggest = { key, hits, index: 0 };
  if (!hits.length) {
    box.innerHTML = q.trim() ? `<div class="pad-none">No match for “${esc(q)}”</div>` : "";
    box.classList.toggle("open", !!q.trim());
    return;
  }
  box.innerHTML = hits.map((p, i) => `<button data-pick="${p.id}" class="${i === 0 ? "on" : ""}">
      <span class="sg-media">${p.img ? `<img src="${p.img}" alt="">` : (p.emoji || "📦")}</span>
      <span class="sg-name"><b>${esc(p.name)}</b><small>${esc(p.brand)} · ${esc(p.unit)}</small></span>
      <span class="sg-stock ${p.stock ? "" : "oos"}">${p.stock ? p.stock + " in stock" : "Out of stock"}</span>
    </button>`).join("");
  box.classList.add("open");
  // Product ids are cuid strings — coercing with + yields NaN and picks nothing.
  box.querySelectorAll("[data-pick]").forEach(b => b.onmousedown = e => { e.preventDefault(); pick(key, b.dataset.pick); });
}
function hideSuggest(key) {
  const box = document.querySelector(`[data-sg="${key}"]`);
  if (box) { box.classList.remove("open"); box.innerHTML = ""; }
}

function handleSearchKey(e, key, inp) {
  if (!activeSuggest || activeSuggest.key !== key) return;
  const { hits } = activeSuggest;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!hits.length) return;
    activeSuggest.index = (activeSuggest.index + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
    document.querySelectorAll(`[data-sg="${key}"] button`).forEach((b, i) => b.classList.toggle("on", i === activeSuggest.index));
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (hits.length) pick(key, hits[activeSuggest.index].id);
  } else if (e.key === "Escape") hideSuggest(key);
}

function pick(key, productId) {
  const r = rows.find(r => r.key === key);
  const p = getProduct(productId);
  r.productId = productId;
  if (!r.qty) r.qty = Math.min(p.moq, p.stock || p.moq);
  hideSuggest(key);
  render();
  const q = document.querySelector(`[data-qty="${key}"]`);
  if (q) { q.focus(); q.select(); }
}

function focusRow(key) {
  const el = document.querySelector(`[data-find="${key}"]`);
  if (el) el.focus();
}

function loadOrderIntoPad(number) {
  const o = RECENT_ORDERS.find(x => x.number === number);
  if (!o) return;
  // The order carries the product id, which is the only unambiguous way back:
  // its description is a "name + size" snapshot, and the same product is sold in
  // several pack sizes. Older orders predate the id, so fall back to matching
  // that snapshot against name + size, then to the name alone.
  const products = getProducts();
  const byId = new Map(products.map(p => [String(p.id), p]));
  const key = s => String(s).toLowerCase().replace(/\s+/g, " ").trim();
  const byNameSize = new Map(products.map(p => [key(`${p.name} ${p.size}`), p]));
  const byName = new Map(products.map(p => [key(p.name), p]));

  rows = o.lines.map(l => {
    const p = byId.get(String(l.productId))
      ?? byNameSize.get(key(l.description))
      ?? byName.get(key(l.description));
    return p ? { key: nextKey++, productId: p.id, qty: l.qtyCases } : null;
  }).filter(Boolean);
  const missing = o.lines.length - rows.length;
  rows.push({ key: nextKey++, productId: null, qty: null });
  render();
  toast(`${o.number} loaded${missing ? ` \u00b7 ${missing} line(s) no longer stocked` : ""}`, "\u21bb");
}

function addAllToCart() {
  const cart = getCart();
  let added = 0, capped = [];
  rows.forEach(r => {
    const p = rowProduct(r);
    if (!p || !r.qty) return;
    const room = Math.max(0, p.stock - (cart[p.id] || 0));
    const qty = Math.min(r.qty, room);
    if (qty <= 0) { capped.push(`${p.name} (out of stock)`); return; }
    if (qty < r.qty) capped.push(`${p.name} (${qty} of ${r.qty})`);
    cart[p.id] = (cart[p.id] || 0) + qty;
    added += qty;
  });
  if (!added) { toast("Nothing could be added — check stock levels", "⚠️"); return; }
  saveCart(cart);
  showModal(`<div class="co-success"><span class="big">🛒</span>
    <h3>${added} cases added to your order</h3>
    ${capped.length ? `<div class="skip-list"><b>Adjusted for stock</b>${capped.map(c => `<small>${esc(c)}</small>`).join("")}</div>`
      : `<p>Everything on the pad went in at the quantity you entered.</p>`}
    <div class="msg-actions">
      <button class="btn btn-ghost" data-close>Keep adding</button>
      <a class="btn btn-primary" href="index.html#catalogue">Review &amp; place order →</a>
    </div></div>`);
  rows = [{ key: nextKey++, productId: null, qty: null }];
  render();
}

/* ---------------- modal ---------------- */
function showModal(html) {
  $("modal").innerHTML = html;
  $("modalOverlay").classList.add("open");
  $("modal").querySelectorAll("[data-close]").forEach(b => b.onclick = closeModal);
}
const closeModal = () => $("modalOverlay").classList.remove("open");
$("modalOverlay").onclick = e => { if (e.target === $("modalOverlay")) closeModal(); };
addEventListener("keydown", e => e.key === "Escape" && closeModal());

(async () => {
  await loadSession();
  vendor = currentVendor();
  if (!vendor) { location.href = "login.html"; }
  else {
    await loadCatalogue();
    RECENT_ORDERS = await myOrders();
    render();
    focusRow(rows[0].key);
  }
})();
