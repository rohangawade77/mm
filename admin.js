/* ============ GROCERY — admin panel ============ */
requireAdmin();
const $ = id => document.getElementById(id);
mountLogos();

let view = "dashboard", customerId = null, analyticsDays = 30;
let vendorQuery = "", vendorFilter = "all", vendorSort = { key:"shop", dir:"asc" };
let orderQuery = "", orderFilter = "all", orderSort = { key:"placedAt", dir:"desc" };
let prodQuery = "", prodCat = "all", prodSort = { key:"name", dir:"asc" };
let pendingImg;                    // staged image while the product form is open

$("logoutBtn").onclick = () => { logout(); location.href = "index.html"; };
document.querySelectorAll(".side-link[data-view]").forEach(b => b.onclick = () => goto(b.dataset.view));
function goto(v) {
  view = v; customerId = null;
  document.querySelectorAll(".side-link[data-view]").forEach(x => x.classList.toggle("active", x.dataset.view === v));
  render();
}

const TIER_KEYS = ["A", "B", "C"];
const statusChip = s => `<span class="status ${s}">${s}</span>`;
const tierChip = t => t ? `<span class="tier-chip tier-${t}">TIER ${t}</span>` : `<span class="tier-chip none">—</span>`;
const thumb = p => p.img ? `<img class="t-img" src="${p.img}" alt="">` : `<span class="t-emoji">${p.emoji || "📦"}</span>`;

const th = (label, key, state, extra = "") =>
  `<th class="sortable ${state.key === key ? "sorted " + state.dir : ""}" data-sort="${key}">${label}${extra}<i></i></th>`;
function wireSort(state) {
  document.querySelectorAll("[data-sort]").forEach(h => h.onclick = () => {
    const k = h.dataset.sort;
    if (state.key === k) state.dir = state.dir === "asc" ? "desc" : "asc";
    else { state.key = k; state.dir = "asc"; }
    render();
  });
}

function render() {
  const db = dbLoad();
  const pending = db.vendors.filter(v => v.status === "pending").length;
  $("pendingPill").textContent = pending;
  $("pendingPill").style.display = pending ? "" : "none";
  if (customerId) return customerDetail(db);
  ({ dashboard, analytics, applications, vendors, orders, products, tiers, settings })[view](db);
}

/* ================= DASHBOARD ================= */
function dashboard(db) {
  const pending = db.vendors.filter(v => v.status === "pending");
  const approved = db.vendors.filter(v => v.status === "approved");
  const s = salesSummary(30);
  const open = db.orders.filter(o => ["received","packing","packed","partial"].includes(o.status)).length;
  const byTier = TIER_KEYS.map(k => ({ k, n: approved.filter(v => v.tier === k).length }));
  const maxTier = Math.max(1, ...byTier.map(t => t.n));
  const lowAt = db.settings.lowStockAt;
  const low = db.products.filter(p => p.stock <= lowAt).sort((a, b) => a.stock - b.stock);

  $("appMain").innerHTML = `
    <div class="page-head"><h1>Dashboard</h1><p>Overview of your wholesale operation.</p></div>
    <div class="stat-grid">
      ${statCard("📨", pending.length, "Pending applications", pending.length ? "action" : "")}
      ${statCard("🏪", approved.length, "Active customers")}
      ${statCard("📦", open, "Orders to fulfil", open ? "action" : "")}
      ${statCard("💷", money(s.revenue), "Revenue, last 30 days")}
    </div>
    <div class="two-col">
      <section class="panel">
        <div class="panel-head"><h2>Customers by tier</h2>
          <button class="btn btn-ghost sm" data-goto="analytics">Analytics →</button></div>
        <div class="bar-chart">
          ${byTier.map(t => `<div class="bar-row">
            <span class="bar-label">${tierChip(t.k)} <small>−${db.tiers[t.k].discount}%</small></span>
            <div class="bar-track"><div class="bar-fill tier-${t.k}" style="width:${t.n / maxTier * 100}%"></div></div>
            <b>${t.n}</b></div>`).join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Latest applications</h2>
          <button class="btn btn-ghost sm" data-goto="applications">View all</button></div>
        ${pending.length ? `<div class="mini-list">${pending.slice(0, 4).map(v => `
          <div class="mini-row"><div><b>${esc(v.shop)}</b><small>${esc(v.name)} · ${fmtDate(v.createdAt)}</small></div>
          <button class="btn btn-primary sm" data-goto="applications">Review</button></div>`).join("")}</div>`
          : `<div class="empty-inline">✅ No applications waiting — you're all caught up.</div>`}
      </section>
    </div>
    <section class="panel">
      <div class="panel-head"><h2>Low stock <small class="muted">at or below ${lowAt} cases</small></h2>
        <button class="btn btn-ghost sm" data-goto="products">Manage products</button></div>
      ${low.length ? `<div class="mini-list">${low.slice(0, 6).map(p => `
        <div class="mini-row"><div class="mini-prod">${thumb(p)}<div><b>${esc(p.name)}</b><small>${esc(p.brand)} · ${esc(p.unit)}</small></div></div>
        <span class="${p.stock === 0 ? "oos-pill" : "low"}">${p.stock === 0 ? "OUT OF STOCK" : p.stock + " left"}</span></div>`).join("")}
        ${low.length > 6 ? `<p class="muted sm">…and ${low.length - 6} more.</p>` : ""}</div>`
        : `<div class="empty-inline">All lines comfortably stocked.</div>`}
    </section>`;
  wire();
}
const statCard = (ico, val, label, cls = "") =>
  `<div class="stat-card ${cls}"><span class="stat-ico">${ico}</span><b>${val}</b><small>${label}</small></div>`;

/* ================= ANALYTICS ================= */
function analytics(db) {
  const s = salesSummary(analyticsDays);
  const max = Math.max(1, ...s.series.map(d => d.value));
  const tierTotal = Math.max(1, s.byTier.reduce((a, t) => a + t.revenue, 0));

  $("appMain").innerHTML = `
    <div class="page-head"><h1>Analytics</h1><p>Trading performance across your customer base.</p></div>

    <div class="toolbar">
      <div class="seg">
        ${[[7,"7 days"],[30,"30 days"],[90,"90 days"],[365,"12 months"]].map(([d,l]) =>
          `<button class="seg-btn ${analyticsDays===d?"on":""}" data-days="${d}">${l}</button>`).join("")}
      </div>
      <div class="toolbar-right">
        <button class="btn btn-ghost" id="dlPeriod">⬇ Export period</button>
      </div>
    </div>

    <div class="stat-grid">
      ${statCard("💷", money(s.revenue), `Revenue, last ${analyticsDays} days`)}
      ${statCard("🧾", s.orders.length, "Orders")}
      ${statCard("📦", s.cases, "Cases sold")}
      ${statCard("📊", money(s.avgOrder), "Average order value")}
    </div>

    <section class="panel">
      <div class="panel-head"><h2>Revenue</h2><small class="muted">Net of discount, by day</small></div>
      ${s.revenue ? `<div class="chart">
        ${s.series.map(d => `<div class="chart-col" title="${new Date(d.date).toLocaleDateString('en-GB')} · ${money(d.value)}">
          <div class="chart-bar" style="height:${d.value / max * 100}%"></div></div>`).join("")}
      </div>
      <div class="chart-axis"><span>${new Date(s.series[0].date).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</span>
        <span>peak ${money(max)}</span>
        <span>${new Date(s.series.at(-1).date).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</span></div>`
      : `<div class="empty-inline big">No orders in this period.</div>`}
    </section>

    <div class="two-col">
      <section class="panel">
        <div class="panel-head"><h2>Top products</h2></div>
        ${s.topProducts.length ? `<div class="rank-list">${s.topProducts.map((p, i) => `
          <div class="rank-row"><span class="rank-n">${i + 1}</span>
            <span class="rank-media">${p.img ? `<img src="${p.img}" alt="">` : (p.emoji || "📦")}</span>
            <div><b>${esc(p.name)}</b><small>${p.cases} cases</small></div>
            <b class="rank-val">${money(p.revenue)}</b></div>`).join("")}</div>`
          : `<div class="empty-inline">No sales yet.</div>`}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Top customers</h2></div>
        ${s.topCustomers.length ? `<div class="rank-list">${s.topCustomers.map((c, i) => `
          <div class="rank-row"><span class="rank-n">${i + 1}</span>
            <div><b>${esc(c.shop)}</b><small>${c.orders} order${c.orders===1?"":"s"} · ${tierChip(c.tier)}</small></div>
            <b class="rank-val">${money(c.revenue)}</b></div>`).join("")}</div>`
          : `<div class="empty-inline">No sales yet.</div>`}
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><h2>Revenue by tier</h2></div>
      <div class="bar-chart">
        ${s.byTier.map(t => `<div class="bar-row">
          <span class="bar-label">${tierChip(t.tier)}</span>
          <div class="bar-track"><div class="bar-fill tier-${t.tier}" style="width:${t.revenue / tierTotal * 100}%"></div></div>
          <b class="wide-val">${money(t.revenue)}</b></div>`).join("")}
      </div>
    </section>`;
  wire();
  document.querySelectorAll("[data-days]").forEach(b => b.onclick = () => { analyticsDays = +b.dataset.days; render(); });
  $("dlPeriod").onclick = () => { exportOrdersCSV(s.orders); toast(`${s.orders.length} orders exported`, "⬇"); };
}

/* ================= APPLICATIONS ================= */
function applications(db) {
  const rows = db.vendors.filter(v => v.status === "pending");
  $("appMain").innerHTML = `
    <div class="page-head"><h1>Applications</h1><p>Approve a business and assign its discount tier, or reject the request.</p></div>
    ${rows.length ? `<div class="app-cards">${rows.map(v => `
      <div class="app-card">
        <div class="app-card-head">
          <div><b>${esc(v.shop)}</b><small>${v.id} · applied ${fmtDate(v.createdAt)}</small></div>
          ${statusChip(v.status)}
        </div>
        <dl class="kv">
          <div><dt>Contact</dt><dd>${esc(v.name)}</dd></div>
          <div><dt>Email</dt><dd>${esc(v.email)}</dd></div>
          <div><dt>Phone</dt><dd>${esc(v.phone)}</dd></div>
        </dl>
        <div class="tier-pick"><span>Assign tier:</span>
          ${TIER_KEYS.map(k => `<button class="tier-btn tier-${k}" data-approve="${v.id}" data-tier="${k}">
            ${k} <small>−${db.tiers[k].discount}%</small></button>`).join("")}
        </div>
        <button class="btn btn-ghost full danger" data-reject="${v.id}">Reject application</button>
      </div>`).join("")}</div>`
      : `<div class="empty-inline big">✅ No pending applications.</div>`}`;
  wire();
}

/* ================= CUSTOMERS ================= */
function vendors(db) {
  let rows = db.vendors.filter(v => v.status !== "pending");
  if (vendorFilter !== "all") rows = rows.filter(v => v.status === vendorFilter);
  if (vendorQuery) rows = rows.filter(v => (v.shop + v.name + v.email + v.id).toLowerCase().includes(vendorQuery));
  const ordersOf = id => db.orders.filter(o => o.vendorId === id);
  rows = sortRows(rows, vendorSort.key, vendorSort.dir, {
    discount: v => v.tier ? db.tiers[v.tier].discount : -1,
    createdAt: v => new Date(v.createdAt).getTime(),
    orders: v => ordersOf(v.id).length,
    spend: v => ordersOf(v.id).reduce((s, o) => s + o.net, 0),
  });

  $("appMain").innerHTML = `
    <div class="page-head"><h1>Customers</h1><p>Every wholesale account and the tier controlling its pricing.</p></div>
    <div class="toolbar">
      <input class="search-field" id="vSearch" placeholder="Search shop, contact or email…" value="${esc(vendorQuery)}">
      <div class="seg">
        ${[["all","All"],["approved","Active"],["suspended","Suspended"],["rejected","Rejected"]].map(([v,l]) =>
          `<button class="seg-btn ${vendorFilter===v?"on":""}" data-vfilter="${v}">${l}</button>`).join("")}
      </div>
      <div class="toolbar-right">
        <button class="btn btn-ghost" id="dlVendorsView">⬇ View (${rows.length})</button>
        <button class="btn btn-primary" id="dlVendorsAll">⬇ All customers</button>
      </div>
    </div>
    <div class="table-wrap wide"><table class="tbl">
      <thead><tr>
        ${th("Business","shop",vendorSort)}${th("Contact","name",vendorSort)}${th("Tier","tier",vendorSort)}
        ${th("Discount","discount",vendorSort)}${th("Orders","orders",vendorSort)}${th("Spend","spend",vendorSort)}
        <th>Login</th>${th("Status","status",vendorSort)}<th></th>
      </tr></thead>
      <tbody>${rows.length ? rows.map(v => {
        const mine = ordersOf(v.id);
        const ovc = Object.keys(v.overrides || {}).length;
        return `<tr class="clickable" data-open="${v.id}">
          <td><b>${esc(v.shop)}</b><small>${v.id}${ovc ? ` · ${ovc} special price${ovc===1?"":"s"}` : ""}</small></td>
          <td>${esc(v.name)}<small>${esc(v.email)}<br>${esc(v.phone)}</small></td>
          <td>${tierChip(v.tier)}</td>
          <td><b class="disc">${v.tier ? db.tiers[v.tier].discount + "%" : "—"}</b></td>
          <td>${mine.length}</td>
          <td><b>${money(mine.reduce((s, o) => s + o.net, 0))}</b></td>
          <td>${v.password ? `<code class="pw">${v.password}</code>` : "—"}</td>
          <td>${statusChip(v.status)}</td>
          <td class="row-actions"><button class="btn btn-ghost sm" data-open="${v.id}">Open →</button></td>
        </tr>`;
      }).join("") : `<tr><td colspan="9" class="empty-cell">No customers match this filter.</td></tr>`}
      </tbody></table></div>`;
  wire(); wireSort(vendorSort);
  liveSearch("vSearch", val => { vendorQuery = val; });
  $("dlVendorsAll").onclick = () => { exportVendorsCSV(); toast("All customers exported", "⬇"); };
  $("dlVendorsView").onclick = () => { exportVendorsCSV(rows); toast(`${rows.length} customers exported`, "⬇"); };
}

/* ---- customer detail ---- */
function customerDetail(db) {
  const v = db.vendors.find(x => x.id === customerId);
  if (!v) { customerId = null; return render(); }
  const mine = db.orders.filter(o => o.vendorId === v.id);
  const spend = mine.reduce((s, o) => s + o.net, 0);
  const saved = mine.reduce((s, o) => s + o.discount, 0);
  const overrides = Object.entries(v.overrides || {});

  $("appMain").innerHTML = `
    <button class="back-link" data-goto="vendors">← All customers</button>
    <div class="page-head detail-head">
      <div><h1>${esc(v.shop)}</h1><p>${v.id} · ${esc(v.name)} · joined ${fmtDate(v.createdAt)}</p></div>
      <div class="detail-actions">${statusChip(v.status)} ${tierChip(v.tier)}</div>
    </div>

    <div class="stat-grid">
      ${statCard("📦", mine.length, "Orders placed")}
      ${statCard("💷", money(spend), "Lifetime spend")}
      ${statCard("🏷️", money(saved), "Discount given")}
      ${statCard("📊", money(mine.length ? spend / mine.length : 0), "Average order")}
    </div>

    <div class="two-col">
      <section class="panel">
        <div class="panel-head"><h2>Account</h2></div>
        <div class="co-fields">
          <div class="full-w"><label>Business name</label><input id="cd-shop" value="${esc(v.shop)}"></div>
          <div><label>Contact</label><input id="cd-name" value="${esc(v.name)}"></div>
          <div><label>Phone</label><input id="cd-phone" value="${esc(v.phone)}"></div>
          <div class="full-w"><label>Email</label><input id="cd-email" value="${esc(v.email)}"></div>
          <div class="full-w"><label>Delivery address</label><input id="cd-address" value="${esc(v.address || "")}" placeholder="Used on invoices and delivery notes"></div>
          <div><label>Pricing tier</label><select id="cd-tier" ${v.status !== "approved" ? "disabled" : ""}>
            ${TIER_KEYS.map(k => `<option value="${k}" ${v.tier===k?"selected":""}>Tier ${k} — ${db.tiers[k].discount}% off</option>`).join("")}
          </select></div>
          <div><label>Trade password</label><input id="cd-pass" value="${esc(v.password || "")}" placeholder="—"></div>
          <div class="full-w"><label>Internal notes</label><input id="cd-notes" value="${esc(v.notes || "")}" placeholder="Not visible to the customer"></div>
        </div>
        <div class="co-nav">
          ${v.status === "approved"
            ? `<button class="btn btn-ghost danger" data-suspend="${v.id}">Suspend account</button>`
            : `<button class="btn btn-ghost" data-reinstate="${v.id}">Reinstate account</button>`}
          <button class="btn btn-primary" id="cd-save">Save changes</button>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Special prices</h2>
          <button class="btn btn-ghost sm" id="addOverride">＋ Add</button></div>
        <p class="muted sm">A fixed price for this customer on specific lines, overriding their Tier ${v.tier || "—"} rate.</p>
        ${overrides.length ? `<div class="mini-list ov-list">${overrides.map(([pid, price]) => {
          const p = getProduct(pid);
          if (!p) return "";
          return `<div class="mini-row"><div class="mini-prod">${thumb(p)}
            <div><b>${esc(p.name)}</b><small>List ${money(p.list)} · tier price ${money(p.list * (1 - (db.tiers[v.tier]?.discount || 0) / 100))}</small></div></div>
            <div class="ov-right"><b class="net">${money(price)}</b>
              <button class="ci-remove" data-rmov="${pid}">Remove</button></div></div>`;
        }).join("")}</div>` : `<div class="empty-inline">No special prices — this customer pays the standard Tier ${v.tier || "—"} rate.</div>`}
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><h2>Order history</h2>
        <button class="btn btn-ghost sm" id="dlCustOrders">⬇ Export</button></div>
      ${mine.length ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>Order</th><th>Placed</th><th>Cases</th><th>Net</th><th>Status</th><th></th></tr></thead>
        <tbody>${mine.map(o => `<tr>
          <td><b>${o.id}</b><small>${o.invoiceNo || ""}</small></td>
          <td><small>${fmtDateTime(o.placedAt)}</small></td>
          <td>${o.lines.reduce((s,l)=>s+l.qty,0)}</td>
          <td><b>${money(o.net)}</b></td>
          <td>${statusChip(o.status)}</td>
          <td class="row-actions"><button class="btn btn-ghost sm" data-vieworder="${o.id}">View</button></td>
        </tr>`).join("")}</tbody></table></div>`
        : `<div class="empty-inline">No orders yet.</div>`}
    </section>`;
  wire();

  $("cd-save").onclick = () => {
    updateVendor(v.id, {
      shop:$("cd-shop").value.trim(), name:$("cd-name").value.trim(), phone:$("cd-phone").value.trim(),
      email:$("cd-email").value.trim(), address:$("cd-address").value.trim(),
      notes:$("cd-notes").value.trim(), password:$("cd-pass").value.trim() || v.password,
      tier: $("cd-tier").disabled ? v.tier : $("cd-tier").value,
    });
    render(); toast("Customer updated", "💾");
  };
  $("dlCustOrders").onclick = () => { exportOrdersCSV(mine); toast("Orders exported", "⬇"); };
  $("addOverride").onclick = () => overrideDialog(v);
  document.querySelectorAll("[data-rmov]").forEach(b => b.onclick = () => {
    setOverride(v.id, b.dataset.rmov, null); render(); toast("Special price removed", "🗑️");
  });
}

function overrideDialog(v) {
  const tierPct = dbLoad().tiers[v.tier]?.discount || 0;
  showModal(`<div class="co">
    <h3>Special price</h3>
    <p class="co-sub">Set a fixed price for <b>${esc(v.shop)}</b> on one product. It replaces their Tier ${v.tier} rate for that line.</p>
    <div class="co-fields">
      <div class="full-w"><label>Product</label>
        <select id="ov-prod">${getProducts().map(p =>
          `<option value="${p.id}">${esc(p.name)} — list ${money(p.list)}</option>`).join("")}</select></div>
      <div><label>Their tier price</label><input id="ov-tier" disabled></div>
      <div><label>Special price (£)</label><input id="ov-price" type="number" step="0.01" min="0"></div>
    </div>
    <div class="co-nav"><button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" id="ov-save">Save special price</button></div>
  </div>`);
  const sync = () => {
    const p = getProduct($("ov-prod").value);
    $("ov-tier").value = money(p.list * (1 - tierPct / 100));
    if (!$("ov-price").value) $("ov-price").value = (p.list * (1 - tierPct / 100)).toFixed(2);
  };
  $("ov-prod").onchange = () => { $("ov-price").value = ""; sync(); };
  sync();
  $("ov-save").onclick = () => {
    const price = parseFloat($("ov-price").value);
    if (isNaN(price) || price < 0) { toast("Enter a valid price", "⚠️"); return; }
    setOverride(v.id, $("ov-prod").value, price);
    closeModal(); render(); toast("Special price saved", "🏷️");
  };
}

/* ================= ORDERS ================= */
function orders(db) {
  let rows = db.orders;
  if (orderFilter !== "all") rows = rows.filter(o => orderFilter === "open"
    ? ["received","packing","packed","partial"].includes(o.status) : o.status === orderFilter);
  if (orderQuery) rows = rows.filter(o => (o.id + o.vendorShop + o.vendorId + (o.invoiceNo || "")).toLowerCase().includes(orderQuery));
  rows = sortRows(rows, orderSort.key, orderSort.dir, {
    placedAt: o => new Date(o.placedAt).getTime(),
    cases: o => o.lines.reduce((s, l) => s + l.qty, 0),
  });

  $("appMain").innerHTML = `
    <div class="page-head"><h1>Orders</h1><p>Wholesale orders placed through the trade portal.</p></div>
    <div class="toolbar">
      <input class="search-field" id="oSearch" placeholder="Search order, invoice or business…" value="${esc(orderQuery)}">
      <div class="seg">
        ${[["all","All"],["open","Open"],...ORDER_STATUSES.map(s => [s, s[0].toUpperCase()+s.slice(1)])].map(([v,l]) =>
          `<button class="seg-btn ${orderFilter===v?"on":""}" data-ofilter="${v}">${l}</button>`).join("")}
      </div>
      <div class="toolbar-right">
        <button class="btn btn-ghost" id="dlOrdersView">⬇ View (${rows.length})</button>
        <button class="btn btn-ghost" id="dlOrderLines">⬇ Line items</button>
        <button class="btn btn-primary" id="dlOrdersAll">⬇ All orders</button>
      </div>
    </div>
    ${rows.length ? `<div class="table-wrap wide"><table class="tbl">
      <thead><tr>
        ${th("Order","id",orderSort)}${th("Placed","placedAt",orderSort)}${th("Business","vendorShop",orderSort)}
        ${th("Tier","tier",orderSort)}${th("Cases","cases",orderSort)}${th("List","gross",orderSort)}
        ${th("Discount","discount",orderSort)}${th("Net","net",orderSort)}${th("Status","status",orderSort)}<th></th>
      </tr></thead>
      <tbody>${rows.map(o => {
        const short = o.lines.some(l => (l.sent ?? l.qty) < l.qty);
        return `<tr>
          <td><b>${o.id}</b><small>${o.invoiceNo || ""}</small></td>
          <td><small>${fmtDateTime(o.placedAt)}</small></td>
          <td>${esc(o.vendorShop)}<small>${o.vendorId}</small></td>
          <td>${tierChip(o.tier)}</td>
          <td>${o.lines.reduce((s,l)=>s+l.qty,0)}<small>${short ? `<span class="short-flag">${o.lines.reduce((s,l)=>s+(l.sent ?? l.qty),0)} sent</span>` : `${o.lines.length} lines`}</small></td>
          <td>${money(o.gross)}</td>
          <td class="disc-cell">−${money(o.discount)} <small>(${o.discountPct}%)</small></td>
          <td><b>${money(o.net)}</b></td>
          <td><select class="status-select" data-ostatus="${o.id}">
            ${ORDER_STATUSES.map(s => `<option ${o.status===s?"selected":""}>${s}</option>`).join("")}
          </select></td>
          <td class="row-actions"><button class="btn btn-ghost sm" data-vieworder="${o.id}">View</button></td>
        </tr>`;
      }).join("")}</tbody></table></div>`
      : `<div class="empty-inline big">📦 No orders match this filter.</div>`}`;
  wire(); wireSort(orderSort);
  liveSearch("oSearch", val => { orderQuery = val; });
  document.querySelectorAll("[data-ofilter]").forEach(b => b.onclick = () => { orderFilter = b.dataset.ofilter; render(); });
  $("dlOrdersAll").onclick = () => { exportOrdersCSV(); toast("All orders exported", "⬇"); };
  $("dlOrdersView").onclick = () => { exportOrdersCSV(rows); toast(`${rows.length} orders exported`, "⬇"); };
  $("dlOrderLines").onclick = () => { exportOrderLinesCSV(rows); toast("Line items exported", "⬇"); };
}

function viewOrder(id, editing = false) {
  const o = getOrder(id);
  const done = ["dispatched","delivered"].includes(o.status);
  showModal(`<div class="co">
    <h3>${o.id} ${o.invoiceNo ? `<span class="muted sm">· ${o.invoiceNo}</span>` : ""}</h3>
    <p class="co-sub">${esc(o.vendorShop)} · ${esc(o.vendorName)} · ${fmtDateTime(o.placedAt)} · ${tierChip(o.tier)} · ${statusChip(o.status)}</p>

    <div class="doc-btns">
      <button class="btn btn-ghost sm" data-inv="${o.id}">🧾 Invoice</button>
      <button class="btn btn-ghost sm" data-dn="${o.id}">📄 Delivery note</button>
      <button class="btn btn-ghost sm" data-pl="${o.id}">🖨 Pick list</button>
      ${done ? "" : `<button class="btn btn-ghost sm ${editing ? "on" : ""}" id="toggleEdit">${editing ? "✕ Cancel edit" : "✏️ Edit quantities"}</button>`}
      ${done ? "" : `<button class="btn btn-ghost sm" id="partialBtn">⚠️ Part-dispatch</button>`}
    </div>

    <div class="table-wrap compact"><table class="tbl">
      <thead><tr><th>Product</th><th>Pack</th><th class="ta-c">Qty</th><th class="ta-c">Sent</th><th class="ta-r">Unit</th><th class="ta-r">Line</th></tr></thead>
      <tbody>${o.lines.map(l => {
        const sent = l.sent ?? l.qty;
        return `<tr>
          <td><b>${esc(l.name)}</b>${l.override ? `<small class="ov-tag">special price</small>` : (l.volPct ? `<small>vol −${l.volPct}%</small>` : "")}</td>
          <td>${esc(l.unit)}</td>
          <td class="ta-c">${editing ? `<input class="mini-num" type="number" min="0" value="${l.qty}" data-q="${l.id}">` : l.qty}</td>
          <td class="ta-c ${sent < l.qty ? "short-flag" : ""}">${sent}</td>
          <td class="ta-r">${money(l.net)}</td>
          <td class="ta-r"><b>${money(l.net * l.qty)}</b></td></tr>`;
      }).join("")}</tbody>
    </table></div>

    <div class="co-summary">
      <div class="row"><span>List total</span><span>${money(o.gross)}</span></div>
      <div class="row"><span>Discount (${o.discountPct}%)</span><span>−${money(o.discount)}</span></div>
      <div class="row total"><span>Net total</span><span>${money(o.net)}</span></div>
    </div>

    ${o.note ? `<div class="apply-note">📝 ${esc(o.note)}</div>` : ""}
    ${o.history?.length ? `<div class="timeline">${o.history.map(h =>
      `<div>${statusChip(h.status)}<small>${fmtDateTime(h.at)} · ${h.by}${h.note ? ` · ${esc(h.note)}` : ""}</small></div>`).join("")}</div>` : ""}

    <div class="co-nav">
      <button class="btn btn-ghost" data-close>Close</button>
      ${editing ? `<button class="btn btn-primary" id="saveLines">Save quantities</button>` : ""}
    </div>
  </div>`);

  $("modal").querySelectorAll("[data-inv]").forEach(b => b.onclick = () => printInvoice(b.dataset.inv));
  $("modal").querySelectorAll("[data-dn]").forEach(b => b.onclick = () => printDeliveryNote(b.dataset.dn));
  $("modal").querySelectorAll("[data-pl]").forEach(b => b.onclick = () => printPickList(b.dataset.pl));
  if ($("toggleEdit")) $("toggleEdit").onclick = () => viewOrder(id, !editing);
  if ($("partialBtn")) $("partialBtn").onclick = () => partialDialog(id);
  if ($("saveLines")) $("saveLines").onclick = () => {
    const map = {};
    document.querySelectorAll("[data-q]").forEach(i => map[i.dataset.q] = i.value);
    updateOrderLines(id, map);
    render(); viewOrder(id, false);
    toast("Order updated — stock adjusted", "✏️");
  };
}

function partialDialog(orderId) {
  const o = getOrder(orderId);
  showModal(`<div class="co">
    <h3>Part-dispatch ${o.id}</h3>
    <p class="co-sub">Send what you have. Outstanding cases keep the order open and appear on the delivery note.</p>
    <div class="table-wrap compact"><table class="tbl">
      <thead><tr><th>Product</th><th class="ta-c">Ordered</th><th class="ta-c">Sending</th></tr></thead>
      <tbody>${o.lines.map(l => `<tr>
        <td><b>${esc(l.name)}</b><small>${esc(l.unit)}</small></td>
        <td class="ta-c">${l.qty}</td>
        <td class="ta-c"><input class="mini-num" type="number" min="0" max="${l.qty}" value="${l.sent ?? l.qty}" data-sent="${l.id}"></td>
      </tr>`).join("")}</tbody></table></div>
    <div class="co-nav"><button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" id="confirmPartial">Confirm dispatch</button></div>
  </div>`);
  $("confirmPartial").onclick = () => {
    const map = {};
    document.querySelectorAll("[data-sent]").forEach(i => map[i.dataset.sent] = i.value);
    const res = dispatchPartial(orderId, map);
    closeModal(); render();
    toast(res.outstanding ? `Part-dispatched — ${res.outstanding} cases outstanding` : "Dispatched in full", "🚚");
  };
}

/* ================= PRODUCTS ================= */
function products(db) {
  let rows = db.products;
  if (prodCat !== "all") rows = rows.filter(p => p.cat === prodCat);
  if (prodQuery) rows = rows.filter(p => (p.name + p.brand + p.cat + (p.barcode || "")).toLowerCase().includes(prodQuery));
  rows = sortRows(rows, prodSort.key, prodSort.dir);
  const cats = [...new Set(db.products.map(p => p.cat))].sort();
  const st = storageUsed();

  $("appMain").innerHTML = `
    <div class="page-head"><h1>Products</h1><p>${db.products.length} lines in the catalogue. Add, edit or import in bulk from a spreadsheet.</p></div>
    <div class="toolbar">
      <input class="search-field" id="pSearch" placeholder="Search product, brand or barcode…" value="${esc(prodQuery)}">
      <select class="select" id="pCat">
        <option value="all">All categories</option>
        ${cats.map(c => `<option value="${esc(c)}" ${prodCat===c?"selected":""}>${esc(c)}</option>`).join("")}
      </select>
      <div class="toolbar-right">
        <button class="btn btn-ghost" id="dlProducts">⬇ Export</button>
        <button class="btn btn-ghost" id="importBtn">⬆ Import</button>
        <button class="btn btn-primary" id="addBtn">＋ Add product</button>
      </div>
    </div>
    ${st.pct > 60 ? `<div class="storage-meter ${st.pct > 85 ? "warn" : ""}">
      <div><b>Browser storage ${st.mb.toFixed(1)} MB of ~5 MB</b>
      <small>Product images are the bulk of this. Remove some images if you hit the limit.</small></div>
      <div class="meter"><div style="width:${st.pct}%"></div></div></div>` : ""}
    <div class="table-wrap wide"><table class="tbl">
      <thead><tr>
        <th></th>${th("Product","name",prodSort)}${th("Brand","brand",prodSort)}${th("Category","cat",prodSort)}
        ${th("Pack","unit",prodSort)}${th("MOQ","moq",prodSort)}${th("List price","list",prodSort)}
        ${TIER_KEYS.map(k => `<th>Tier ${k} <small>−${db.tiers[k].discount}%</small></th>`).join("")}
        ${th("Stock","stock",prodSort)}<th></th>
      </tr></thead>
      <tbody>${rows.length ? rows.map(p => `<tr>
        <td class="t-cell">${thumb(p)}</td>
        <td><b>${esc(p.name)}</b><small>#${p.id}${p.barcode ? ` · ${esc(p.barcode)}` : ""}${p.flags.length ? " · " + p.flags.join(", ") : ""}</small></td>
        <td>${esc(p.brand)}</td><td>${esc(p.cat)}</td><td>${esc(p.unit)}</td><td>${p.moq}</td>
        <td><b>${money(p.list)}</b></td>
        ${TIER_KEYS.map(k => `<td class="tier-cell">${money(p.list * (1 - db.tiers[k].discount/100))}</td>`).join("")}
        <td>${p.stock === 0 ? `<span class="oos-pill">OUT</span>` : p.stock <= db.settings.lowStockAt ? `<span class="low">${p.stock}</span>` : p.stock}</td>
        <td class="row-actions">
          <button class="btn btn-ghost sm" data-editprod="${p.id}">Edit</button>
          <button class="btn btn-ghost sm danger" data-delprod="${p.id}">Delete</button>
        </td></tr>`).join("") : `<tr><td colspan="13" class="empty-cell">No products match this filter.</td></tr>`}
      </tbody></table></div>`;
  wire(); wireSort(prodSort);
  liveSearch("pSearch", val => { prodQuery = val; });
  $("pCat").onchange = e => { prodCat = e.target.value; render(); };
  $("addBtn").onclick = () => productForm(null);
  $("importBtn").onclick = importDialog;
  $("dlProducts").onclick = () => { exportProductsCSV(rows); toast(`${rows.length} products exported`, "⬇"); };
  document.querySelectorAll("[data-editprod]").forEach(b => b.onclick = () => productForm(+b.dataset.editprod));
  document.querySelectorAll("[data-delprod]").forEach(b => b.onclick = () => {
    const p = getProduct(b.dataset.delprod);
    confirmAction(`Delete "${esc(p.name)}"?`, "It will be removed from the catalogue. Past orders keep their own record of it.",
      () => { deleteProduct(p.id); render(); toast("Product deleted", "🗑️"); });
  });
}

function productForm(id) {
  const p = id ? getProduct(id) : null;
  pendingImg = p ? p.img : null;
  const cats = [...new Set(getProducts().map(x => x.cat))].sort();
  showModal(`<div class="co">
    <h3>${p ? "Edit product" : "Add product"}</h3>
    <p class="co-sub">${p ? `#${p.id} · changes apply to every customer immediately.` : "New lines appear in the catalogue straight away."}</p>

    <div class="img-row">
      <div class="img-preview" id="imgPreview">${pendingImg ? `<img src="${pendingImg}" alt="">` : `<span>${p ? p.emoji : "📦"}</span>`}</div>
      <div class="img-controls">
        <label class="btn btn-ghost sm" for="pf-file">📷 Upload image</label>
        <input type="file" id="pf-file" accept="image/*" hidden>
        <button class="btn btn-ghost sm" id="pf-clearimg" ${pendingImg ? "" : "disabled"}>Remove</button>
        <small class="muted">JPG or PNG. Scaled to 400px and stored in this browser — keep it light.</small>
      </div>
    </div>

    <div class="co-fields">
      <div class="full-w"><label>Product name *</label><input id="pf-name" value="${p ? esc(p.name) : ""}" placeholder="Amul Pure Ghee 1L"></div>
      <div><label>Brand</label><input id="pf-brand" value="${p ? esc(p.brand) : ""}" placeholder="Amul"></div>
      <div><label>Category</label><input id="pf-cat" list="catList" value="${p ? esc(p.cat) : ""}" placeholder="Groceries">
        <datalist id="catList">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist></div>
      <div><label>List price (£) *</label><input id="pf-list" type="number" step="0.01" min="0" value="${p ? p.list : ""}" placeholder="96.00"></div>
      <div><label>Pack / unit</label><input id="pf-unit" value="${p ? esc(p.unit) : ""}" placeholder="Case of 12"></div>
      <div><label>Min order qty</label><input id="pf-moq" type="number" min="1" value="${p ? p.moq : 1}"></div>
      <div><label>Stock (cases)</label><input id="pf-stock" type="number" min="0" value="${p ? p.stock : 0}"></div>
      <div><label>Barcode / EAN</label><input id="pf-barcode" value="${p ? esc(p.barcode || "") : ""}" placeholder="5012345000019"></div>
      <div><label>Icon (emoji fallback)</label><input id="pf-emoji" maxlength="4" value="${p ? p.emoji : "📦"}"></div>
      <div class="full-w"><label>Badge</label><select id="pf-flag">
        <option value="">None</option>
        <option value="best" ${p?.flags.includes("best") ? "selected" : ""}>★ Best seller</option>
        <option value="new" ${p?.flags.includes("new") ? "selected" : ""}>New</option>
      </select></div>
      <div class="full-w"><label>Description</label><input id="pf-desc" value="${p ? esc(p.desc) : ""}" placeholder="Shown on the product quick view"></div>
    </div>
    <div class="co-nav"><button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" id="pf-save">${p ? "Save changes" : "Add product"}</button></div>
  </div>`);

  $("pf-file").onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      $("imgPreview").innerHTML = `<span class="img-loading">…</span>`;
      pendingImg = await resizeImage(file);
      $("imgPreview").innerHTML = `<img src="${pendingImg}" alt="">`;
      $("pf-clearimg").disabled = false;
      toast("Image ready — save to apply", "📷");
    } catch (err) {
      $("imgPreview").innerHTML = `<span>${$("pf-emoji").value || "📦"}</span>`;
      toast(err.message, "⚠️");
    }
  };
  $("pf-clearimg").onclick = () => {
    pendingImg = null;
    $("imgPreview").innerHTML = `<span>${$("pf-emoji").value || "📦"}</span>`;
    $("pf-clearimg").disabled = true;
  };

  $("pf-save").onclick = () => {
    const name = $("pf-name").value.trim(), list = $("pf-list").value;
    $("pf-name").classList.toggle("err", !name);
    $("pf-list").classList.toggle("err", list === "" || +list < 0);
    if (!name || list === "" || +list < 0) { toast("Name and a valid list price are required", "⚠️"); return; }
    const data = {
      name, brand:$("pf-brand").value, cat:$("pf-cat").value || "Groceries", list:+list,
      unit:$("pf-unit").value, moq:$("pf-moq").value, stock:$("pf-stock").value,
      barcode:$("pf-barcode").value, emoji:$("pf-emoji").value, flags:$("pf-flag").value,
      desc:$("pf-desc").value, img: pendingImg,
    };
    const res = p ? updateProduct(p.id, data) : addProduct(data);
    if (!res.ok) { toast(res.error, "⚠️"); return; }
    closeModal(); render();
    toast(p ? "Product updated" : `“${esc(res.product.name)}” added`, p ? "✏️" : "✅");
  };
}

/* ---- spreadsheet import ---- */
function importDialog() {
  showModal(`<div class="co">
    <h3>Import products</h3>
    <p class="co-sub">Upload an <b>.xlsx</b> or <b>.csv</b> file. Rows matching an existing product ID or name are updated; everything else is added.</p>
    <label class="dropzone" id="dropzone">
      <input type="file" id="fileInput" accept=".xlsx,.xlsm,.csv,.txt" hidden>
      <span class="dz-ico">📄</span>
      <b>Choose a file or drag it here</b>
      <small>.xlsx or .csv · first row must be column headings</small>
    </label>
    <div class="import-help">
      <b>Recognised columns</b>
      <code>name · brand · category · list · unit · moq · stock · barcode · emoji · flags · description · id</code>
      <small>Common variations work too — “price”, “pack size”, “qty”, “SKU” and similar are matched automatically.</small>
      <button class="btn btn-ghost sm" id="dlTemplate">⬇ Download template</button>
    </div>
    <div id="importResult"></div>
    <div class="co-nav"><button class="btn btn-ghost" data-close>Close</button></div>
  </div>`);

  $("dlTemplate").onclick = () => { downloadImportTemplate(); toast("Template downloaded", "⬇"); };
  const input = $("fileInput"), zone = $("dropzone");
  input.onchange = () => input.files[0] && handleImport(input.files[0]);
  zone.ondragover = e => { e.preventDefault(); zone.classList.add("over"); };
  zone.ondragleave = () => zone.classList.remove("over");
  zone.ondrop = e => { e.preventDefault(); zone.classList.remove("over"); if (e.dataTransfer.files[0]) handleImport(e.dataTransfer.files[0]); };
}

async function handleImport(file) {
  const out = $("importResult");
  out.innerHTML = `<div class="import-status working">⏳ Reading <b>${esc(file.name)}</b>…</div>`;
  try {
    const { rows, map, unmapped } = await readProductSheet(file);
    if (!rows.length) throw new Error("No data rows found under the heading row.");
    const preview = rows.slice(0, 5);
    const fields = Object.keys(map);
    out.innerHTML = `
      <div class="import-status ok">✅ Read <b>${rows.length}</b> row${rows.length===1?"":"s"} from ${esc(file.name)}</div>
      <div class="import-map">Mapped columns: ${fields.map(f => `<span>${f}</span>`).join("")}
        ${unmapped.length ? `<br><small class="muted">Ignored: ${unmapped.map(esc).join(", ")}</small>` : ""}</div>
      <div class="table-wrap compact"><table class="tbl">
        <thead><tr>${fields.map(f => `<th>${f}</th>`).join("")}</tr></thead>
        <tbody>${preview.map(r => `<tr>${fields.map(f => `<td>${esc(r[f] ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>
      ${rows.length > 5 ? `<p class="muted sm">…and ${rows.length - 5} more row${rows.length-5===1?"":"s"}.</p>` : ""}
      <button class="btn btn-primary full" id="confirmImport">Import ${rows.length} row${rows.length===1?"":"s"}</button>`;
    $("confirmImport").onclick = () => {
      const res = bulkUpsertProducts(rows);
      closeModal(); render();
      showModal(`<div class="co-success"><span class="big">📥</span>
        <h3>Import complete</h3>
        <p><b>${res.added}</b> product${res.added===1?"":"s"} added · <b>${res.updated}</b> updated</p>
        ${res.skipped.length ? `<div class="skip-list"><b>${res.skipped.length} row(s) skipped</b>${res.skipped.slice(0,6).map(s => `<small>${esc(s)}</small>`).join("")}</div>` : ""}
        <div class="msg-actions"><button class="btn btn-primary" data-close>Done</button></div></div>`);
      toast(`${res.added} added, ${res.updated} updated`, "📥");
    };
  } catch (err) {
    out.innerHTML = `<div class="import-status err">⚠️ ${esc(err.message)}</div>`;
  }
}

/* ================= PRICING (tiers + volume breaks) ================= */
function tiers(db) {
  const breaks = [...(db.settings.volumeBreaks || [])].sort((a, b) => a.qty - b.qty);
  $("appMain").innerHTML = `
    <div class="page-head"><h1>Pricing</h1><p>Tier discounts and volume breaks. Both apply automatically at checkout.</p></div>
    <div class="tier-admin-grid">
      ${TIER_KEYS.map(k => {
        const t = db.tiers[k], count = db.vendors.filter(v => v.status === "approved" && v.tier === k).length;
        return `<div class="panel tier-admin tier-${k}">
          <div class="tier-admin-head"><span class="tier-letter">${k}</span>
            <div><b>${esc(t.label)}</b><small>${count} customer${count===1?"":"s"} on this tier</small></div></div>
          <label class="range-label">Discount off list price</label>
          <div class="range-row">
            <input type="range" min="0" max="90" step="1" value="${t.discount}" data-range="${k}">
            <div class="range-val"><input type="number" min="0" max="90" value="${t.discount}" data-num="${k}"><span>%</span></div>
          </div>
          <div class="tier-example" id="ex-${k}">A £100.00 case sells at <b>${money(100 * (1 - t.discount/100))}</b></div>
          <input class="note-field" data-note="${k}" value="${esc(t.note)}" placeholder="Internal note">
          <button class="btn btn-primary full" data-savetier="${k}">Save Tier ${k}</button>
        </div>`;
      }).join("")}
    </div>

    <section class="panel">
      <div class="panel-head"><h2>Volume breaks</h2>
        <button class="btn btn-ghost sm" id="addBreak">＋ Add break</button></div>
      <p class="muted sm">Extra discount when a single line reaches these quantities, added on top of the customer's tier rate.</p>
      <div class="break-list" id="breakList">
        ${breaks.map((b, i) => `<div class="break-row">
          <span>From</span><input type="number" min="1" value="${b.qty}" data-bq="${i}"><span>cases</span>
          <span class="arrow-sep">→</span>
          <span>extra</span><input type="number" min="0" max="50" value="${b.pct}" data-bp="${i}"><span>%</span>
          <button class="pad-del" data-bdel="${i}" title="Remove">✕</button>
        </div>`).join("") || `<div class="empty-inline">No volume breaks — quantity doesn't change the price.</div>`}
      </div>
      <div class="break-preview" id="breakPreview"></div>
      <button class="btn btn-primary" id="saveBreaks">Save volume breaks</button>
    </section>

    <div class="panel info-panel">
      <h2>How a price is worked out</h2>
      <p>Start from the product's list price. If the customer has a <b>special price</b> on that product it wins outright. Otherwise the <b>tier discount</b> and any <b>volume break</b> earned by the line quantity are added together and taken off the list price.</p>
    </div>`;
  wire();

  TIER_KEYS.forEach(k => {
    const range = document.querySelector(`[data-range="${k}"]`), num = document.querySelector(`[data-num="${k}"]`);
    const sync = val => {
      const v = Math.max(0, Math.min(90, +val || 0));
      range.value = v; num.value = v;
      $("ex-" + k).innerHTML = `A £100.00 case sells at <b>${money(100 * (1 - v/100))}</b>`;
    };
    range.oninput = () => sync(range.value);
    num.oninput = () => sync(num.value);
  });

  const readBreaks = () => [...document.querySelectorAll("[data-bq]")].map((el, i) => ({
    qty: Math.max(1, parseInt(el.value, 10) || 1),
    pct: Math.max(0, Math.min(50, parseInt(document.querySelector(`[data-bp="${i}"]`).value, 10) || 0)),
  }));
  const previewBreaks = () => {
    const bs = readBreaks().sort((a, b) => a.qty - b.qty);
    const tierA = db.tiers.A.discount;
    $("breakPreview").innerHTML = bs.length
      ? `<b>Tier A example on a £100 case:</b> ` + [{qty:1,pct:0}, ...bs]
          .map(b => `<span>${b.qty}+ → ${money(100 * (1 - Math.min(90, tierA + b.pct) / 100))}</span>`).join("")
      : "";
  };
  previewBreaks();
  document.querySelectorAll("[data-bq],[data-bp]").forEach(el => el.oninput = previewBreaks);
  document.querySelectorAll("[data-bdel]").forEach(b => b.onclick = () => {
    const bs = readBreaks(); bs.splice(+b.dataset.bdel, 1);
    saveSettings({ volumeBreaks: bs }); render(); toast("Break removed", "🗑️");
  });
  $("addBreak").onclick = () => {
    const bs = readBreaks();
    bs.push({ qty: (bs.at(-1)?.qty || 0) + 10 || 10, pct: (bs.at(-1)?.pct || 0) + 2 });
    saveSettings({ volumeBreaks: bs }); render();
  };
  $("saveBreaks").onclick = () => {
    saveSettings({ volumeBreaks: readBreaks().sort((a, b) => a.qty - b.qty) });
    render(); toast("Volume breaks saved", "💾");
  };
}

/* ================= SETTINGS ================= */
function settings(db) {
  const c = db.settings.company, st = storageUsed();
  $("appMain").innerHTML = `
    <div class="page-head"><h1>Settings</h1><p>Company details for paperwork, stock thresholds and stored data.</p></div>

    <section class="panel">
      <div class="panel-head"><h2>Company details</h2><small class="muted">Printed on invoices and delivery notes</small></div>
      <div class="co-fields">
        <div class="full-w"><label>Trading name</label><input id="s-name" value="${esc(c.name)}"></div>
        <div class="full-w"><label>Address</label><input id="s-address" value="${esc(c.address)}"></div>
        <div><label>Email</label><input id="s-email" value="${esc(c.email)}"></div>
        <div><label>Phone</label><input id="s-phone" value="${esc(c.phone)}"></div>
        <div><label>VAT number</label><input id="s-vat" value="${esc(c.vat)}"></div>
        <div><label>Company number</label><input id="s-reg" value="${esc(c.reg)}"></div>
      </div>
      <div class="co-nav"><button class="btn btn-primary" id="saveCompany">Save company details</button></div>
    </section>

    <div class="two-col">
      <section class="panel">
        <div class="panel-head"><h2>Stock</h2></div>
        <div class="co-fields">
          <div class="full-w"><label>Flag as low stock at or below</label>
            <input id="s-low" type="number" min="0" value="${db.settings.lowStockAt}"></div>
        </div>
        <p class="muted sm">Lines at or under this figure appear in the dashboard's low-stock panel and are highlighted in the catalogue.</p>
        <div class="co-nav"><button class="btn btn-primary" id="saveStock">Save</button></div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Stored data</h2></div>
        <div class="storage-meter ${st.pct > 85 ? "warn" : ""}">
          <div><b>${st.mb.toFixed(2)} MB used of roughly 5 MB</b>
          <small>Everything — products, images, customers and orders — lives in this browser.</small></div>
          <div class="meter"><div style="width:${st.pct}%"></div></div>
        </div>
        <div class="co-nav">
          <button class="btn btn-ghost" id="backupBtn">⬇ Download backup</button>
          <button class="btn btn-ghost danger" id="resetBtn">Reset demo data</button>
        </div>
      </section>
    </div>`;
  wire();

  $("saveCompany").onclick = () => {
    saveSettings({ company: { name:$("s-name").value, address:$("s-address").value, email:$("s-email").value,
      phone:$("s-phone").value, vat:$("s-vat").value, reg:$("s-reg").value } });
    toast("Company details saved", "💾");
  };
  $("saveStock").onclick = () => {
    saveSettings({ lowStockAt: Math.max(0, parseInt($("s-low").value, 10) || 0) });
    render(); toast("Stock threshold saved", "💾");
  };
  $("backupBtn").onclick = () => {
    downloadFile(`grocery-backup-${stamp()}.json`, JSON.stringify(dbLoad(), null, 2), "application/json");
    toast("Backup downloaded", "⬇");
  };
  $("resetBtn").onclick = () => confirmAction("Reset all demo data?",
    "Products, customers and orders return to the starting sample data. This cannot be undone.",
    () => { resetDemoData(); location.reload(); });
}

/* ================= SHARED ================= */
function liveSearch(id, setter) {
  const el = $(id);
  if (!el) return;
  el.oninput = () => {
    const pos = el.selectionStart;
    setter(el.value.trim().toLowerCase());
    render();
    const next = $(id);
    if (next) { next.focus(); next.setSelectionRange(pos, pos); }
  };
}

function wire() {
  document.querySelectorAll("[data-goto]").forEach(b => b.onclick = () => goto(b.dataset.goto));
  document.querySelectorAll("[data-open]").forEach(el => el.onclick = e => {
    e.stopPropagation(); customerId = el.dataset.open; render();
  });

  document.querySelectorAll("[data-approve]").forEach(b => b.onclick = () => {
    const v = approveVendor(b.dataset.approve, b.dataset.tier);
    render();
    showModal(`<div class="co-success"><span class="big">✅</span>
      <h3>${esc(v.shop)} approved</h3>
      <p>Assigned <b>Tier ${v.tier}</b> — a <b>${dbLoad().tiers[v.tier].discount}% discount</b> now applies to every price they see.</p>
      <div class="cred-box"><div><small>Login email</small><code>${esc(v.email)}</code></div>
        <div><small>Trade password</small><code class="big-code">${v.password}</code></div></div>
      <p class="muted">Share these credentials with the customer so they can sign in.</p>
      <div class="msg-actions"><button class="btn btn-primary" data-close>Done</button></div></div>`);
    toast(`${esc(v.shop)} approved as Tier ${v.tier}`, "✅");
  });
  document.querySelectorAll("[data-reject]").forEach(b => b.onclick = () =>
    confirmAction("Reject this application?", "The applicant will not be able to sign in.",
      () => { rejectVendor(b.dataset.reject); render(); toast("Application rejected", "🚫"); }));
  document.querySelectorAll("[data-suspend]").forEach(b => b.onclick = () =>
    confirmAction("Suspend this customer?", "They will be signed out and unable to view prices until reinstated.",
      () => { suspendVendor(b.dataset.suspend); render(); toast("Customer suspended", "⏸️"); }));
  document.querySelectorAll("[data-reinstate]").forEach(b => b.onclick = () => {
    reinstateVendor(b.dataset.reinstate); render(); toast("Customer reinstated", "▶️");
  });
  document.querySelectorAll("[data-vfilter]").forEach(b => b.onclick = () => { vendorFilter = b.dataset.vfilter; render(); });

  document.querySelectorAll("[data-savetier]").forEach(b => b.onclick = () => {
    const k = b.dataset.savetier;
    setTierDiscount(k, +document.querySelector(`[data-num="${k}"]`).value);
    const note = document.querySelector(`[data-note="${k}"]`).value;
    dbUpdate(db => { db.tiers[k].note = note; });
    render(); toast(`Tier ${k} saved`, "💾");
  });

  document.querySelectorAll("[data-ostatus]").forEach(sel => sel.onchange = () => {
    setOrderStatus(sel.dataset.ostatus, sel.value, "admin"); render(); toast("Order status updated", "📦");
  });
  document.querySelectorAll("[data-vieworder]").forEach(b => b.onclick = e => {
    e.stopPropagation(); viewOrder(b.dataset.vieworder);
  });
}

function showModal(html) {
  $("modal").innerHTML = html;
  $("modalOverlay").classList.add("open");
  $("modal").querySelectorAll("[data-close]").forEach(b => b.onclick = closeModal);
}
const closeModal = () => $("modalOverlay").classList.remove("open");
$("modalOverlay").onclick = e => { if (e.target === $("modalOverlay")) closeModal(); };
addEventListener("keydown", e => e.key === "Escape" && closeModal());

function confirmAction(title, body, onYes) {
  showModal(`<div class="co-success"><span class="big">⚠️</span><h3>${title}</h3><p>${body}</p>
    <div class="msg-actions"><button class="btn btn-ghost" data-close>Cancel</button>
    <button class="btn btn-primary" id="confirmYes">Yes, continue</button></div></div>`);
  $("confirmYes").onclick = () => { closeModal(); onYes(); };
}

render();
