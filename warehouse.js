/* ============ GROCERY — warehouse portal ============
   Fulfilment only: order contents and status. No pricing is
   rendered anywhere on this page. Admins can open it directly.  */
requireWarehouseAccess();
const $ = id => document.getElementById(id);
mountLogos();

const asAdmin = isAdmin();
let filter = "open", sortKey = "placedAt", sortDir = "asc";
let scanOrder = null;              // order id currently in scan mode
let scanned = {};                  // { orderId: { lineId: pickedQty } }
let cameraStream = null;

$("logoutBtn").onclick = () => {
  if (asAdmin) { location.href = "admin.html"; return; }
  logout(); location.href = "index.html";
};
if (asAdmin) {
  $("logoutBtn").textContent = "← Back to admin";
  $("roleChip").textContent = "ADMIN VIEW";
  $("roleChip").className = "role-chip admin";
}
$("refreshBtn").onclick = () => { render(); toast("Order list refreshed", "↻"); };

const NEXT_ACTION = {
  received:   { to:"packing",    label:"Start packing",      icon:"📦" },
  packing:    { to:"packed",     label:"Mark as packed",     icon:"✅" },
  packed:     { to:"dispatched", label:"Mark as dispatched", icon:"🚚" },
  partial:    { to:"dispatched", label:"Complete dispatch",  icon:"🚚" },
  dispatched: null,
  delivered:  null,
};

function visibleOrders() {
  let rows = getOrders();
  if (filter === "open") rows = rows.filter(o => ["received","packing","packed","partial"].includes(o.status));
  else if (filter !== "all") rows = rows.filter(o => o.status === filter);
  return sortRows(rows, sortKey, sortDir, {
    placedAt: o => new Date(o.placedAt).getTime(),
    cases: o => o.lines.reduce((s, l) => s + l.qty, 0),
  });
}

function render() {
  const all = getOrders();
  const count = s => all.filter(o => o.status === s).length;
  const openCount = all.filter(o => ["received","packing","packed","partial"].includes(o.status)).length;
  const rows = visibleOrders();

  $("whMain").innerHTML = `
    ${asAdmin ? `<div class="banner ok admin-note">
      <span class="banner-ico">🛠</span>
      <div><b>Viewing as admin</b><small>You have full warehouse controls here — no separate warehouse login needed.</small></div>
      <a class="btn btn-ghost" href="admin.html">Back to admin</a></div>` : ""}

    <div class="page-head">
      <h1>Fulfilment Queue</h1>
      <p>Orders received from trade customers. Pick, pack and dispatch — then update the status.</p>
    </div>

    <div class="stat-grid">
      <div class="stat-card ${count("received") ? "action" : ""}"><span class="stat-ico">📨</span><b>${count("received")}</b><small>New to pack</small></div>
      <div class="stat-card"><span class="stat-ico">📦</span><b>${count("packing")}</b><small>Being packed</small></div>
      <div class="stat-card"><span class="stat-ico">✅</span><b>${count("packed")}</b><small>Packed, awaiting van</small></div>
      <div class="stat-card ${count("partial") ? "action" : ""}"><span class="stat-ico">⚠️</span><b>${count("partial")}</b><small>Part-dispatched</small></div>
    </div>

    <div class="toolbar">
      <div class="seg">
        ${[["open",`Open (${openCount})`],["received","New"],["packing","Packing"],["packed","Packed"],
           ["partial","Partial"],["dispatched","Dispatched"],["all","All"]]
          .map(([v,l]) => `<button class="seg-btn ${filter===v?"on":""}" data-filter="${v}">${l}</button>`).join("")}
      </div>
      <div class="sort-group">
        <label>Sort</label>
        <select class="select" id="sortSel">
          <option value="placedAt">Date received</option>
          <option value="id">Order number</option>
          <option value="vendorShop">Business</option>
          <option value="cases">Case count</option>
          <option value="status">Status</option>
        </select>
        <button class="icon-btn sm" id="dirBtn" title="Toggle direction">${sortDir === "asc" ? "↑" : "↓"}</button>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-ghost" id="printAll">🖨 Print all pick lists (${rows.length})</button>
      </div>
    </div>

    ${rows.length ? `<div class="wh-grid">${rows.map(orderCard).join("")}</div>`
      : `<div class="empty-inline big">🎉 Nothing in this queue right now.</div>`}`;

  $("sortSel").value = sortKey;
  $("sortSel").onchange = e => { sortKey = e.target.value; render(); };
  $("dirBtn").onclick = () => { sortDir = sortDir === "asc" ? "desc" : "asc"; render(); };
  $("printAll").onclick = () => rows.forEach((o, i) => setTimeout(() => printPickList(o.id), i * 350));
  document.querySelectorAll("[data-filter]").forEach(b => b.onclick = () => { filter = b.dataset.filter; stopCamera(); scanOrder = null; render(); });

  document.querySelectorAll("[data-advance]").forEach(b => b.onclick = () => {
    setOrderStatus(b.dataset.advance, b.dataset.to, asAdmin ? "admin" : "warehouse");
    render();
    toast(`${b.dataset.advance} → ${b.dataset.to}`, "✅");
  });
  document.querySelectorAll("[data-revert]").forEach(b => b.onclick = () => {
    setOrderStatus(b.dataset.revert, b.dataset.to, asAdmin ? "admin" : "warehouse");
    render(); toast("Status moved back", "↩️");
  });
  document.querySelectorAll("[data-print]").forEach(b => b.onclick = () => printPickList(b.dataset.print));
  document.querySelectorAll("[data-note]").forEach(b => b.onclick = () => printDeliveryNote(b.dataset.note));
  document.querySelectorAll("[data-scan]").forEach(b => b.onclick = () => toggleScan(b.dataset.scan));
  document.querySelectorAll("[data-short]").forEach(b => b.onclick = () => shortDialog(b.dataset.short));

  if (scanOrder) mountScanner();
}

function orderCard(o) {
  const cases = o.lines.reduce((s, l) => s + l.qty, 0);
  const next = NEXT_ACTION[o.status];
  const back = { packing:"received", packed:"packing", dispatched:"packed", partial:"packing" }[o.status];
  const picks = scanned[o.id] || {};
  const allPicked = o.lines.every(l => (picks[l.id] || 0) >= l.qty);
  const scanning = scanOrder === o.id;
  const done = ["dispatched","delivered"].includes(o.status);

  return `<article class="wh-card status-${o.status} ${scanning ? "scanning" : ""}">
    <div class="wh-head">
      <div><b>${o.id}</b><small>${esc(o.vendorShop)}</small></div>
      <span class="status ${o.status}">${o.status}</span>
    </div>
    <div class="wh-meta">
      <span>🕒 ${fmtDateTime(o.placedAt)}</span>
      <span>📦 ${cases} cases · ${o.lines.length} lines</span>
      ${o.vendorPhone ? `<span>📞 ${esc(o.vendorPhone)}</span>` : ""}
    </div>

    ${scanning ? scannerPanel(o) : ""}

    <ul class="pick-list">
      ${o.lines.map(l => {
        const got = picks[l.id] || 0;
        const full = got >= l.qty;
        const sent = l.sent ?? l.qty;
        const short = sent < l.qty;
        return `<li class="${full ? "picked" : ""}">
          <span class="pick-check">${full ? "✓" : ""}</span>
          <span class="pick-emoji">${l.img ? `<img src="${l.img}" alt="">` : (l.emoji || "📦")}</span>
          <div><b>${esc(l.name)}</b><small>${esc(l.unit)}${l.barcode ? ` · ${esc(l.barcode)}` : ""}${short ? ` · <span class="short-flag">${sent}/${l.qty} sent</span>` : ""}</small></div>
          <span class="pick-qty">${got ? `<i>${got}/</i>` : ""}×${l.qty}</span>
        </li>`;
      }).join("")}
    </ul>

    ${o.note ? `<div class="wh-note">📝 ${esc(o.note)}</div>` : ""}

    <div class="wh-actions">
      <button class="btn btn-ghost sm" data-print="${o.id}">🖨 Pick list</button>
      <button class="btn btn-ghost sm" data-note="${o.id}">📄 Delivery note</button>
      ${done ? "" : `<button class="btn btn-ghost sm ${scanning ? "on" : ""}" data-scan="${o.id}">${scanning ? "✕ Stop scan" : "📷 Scan"}</button>`}
      ${done ? "" : `<button class="btn btn-ghost sm" data-short="${o.id}">⚠️ Short ship</button>`}
      ${back ? `<button class="btn btn-ghost sm" data-revert="${o.id}" data-to="${back}">↩ ${back}</button>` : ""}
      ${next ? `<button class="btn btn-primary" data-advance="${o.id}" data-to="${next.to}">
                  ${next.icon} ${next.label}${allPicked && o.status === "packing" ? " ✓" : ""}</button>`
             : `<span class="wh-done">✔ Complete</span>`}
    </div>
  </article>`;
}

/* ---------------- barcode scanning ----------------
   Two inputs: a hardware wedge scanner (types then presses Enter) and,
   where the browser supports BarcodeDetector, the device camera.      */
function scannerPanel(o) {
  const picks = scanned[o.id] || {};
  const total = o.lines.reduce((s, l) => s + l.qty, 0);
  const got = o.lines.reduce((s, l) => s + Math.min(picks[l.id] || 0, l.qty), 0);
  const camOK = "BarcodeDetector" in window;
  return `<div class="scan-panel">
    <div class="scan-row">
      <input id="scanInput" class="scan-input" placeholder="Scan or type a barcode…" autocomplete="off">
      <button class="btn btn-ghost sm" id="camBtn">${cameraStream ? "⏹ Stop camera" : (camOK ? "📷 Use camera" : "📷 Unsupported")}</button>
    </div>
    <div class="scan-progress"><div class="scan-fill" style="width:${total ? got / total * 100 : 0}%"></div></div>
    <div class="scan-stat">${got} of ${total} cases picked${got >= total ? " — all items found ✓" : ""}
      <button class="scan-reset" id="scanReset">Reset</button></div>
    <video id="scanVideo" class="scan-video ${cameraStream ? "on" : ""}" playsinline muted></video>
    <div class="scan-log" id="scanLog"></div>
  </div>`;
}

function toggleScan(orderId) {
  stopCamera();
  scanOrder = scanOrder === orderId ? null : orderId;
  render();
}

function mountScanner() {
  const inp = $("scanInput");
  if (!inp) return;
  inp.focus();
  inp.onkeydown = e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    handleScan(inp.value);
    inp.value = "";
  };
  $("scanReset").onclick = () => { scanned[scanOrder] = {}; render(); };
  $("camBtn").onclick = () => cameraStream ? (stopCamera(), render()) : startCamera();
}

function handleScan(code) {
  const o = getOrder(scanOrder);
  if (!o || !code.trim()) return;
  const c = String(code).trim();
  const line = o.lines.find(l => l.barcode && String(l.barcode).trim() === c)
            || o.lines.find(l => String(l.id) === c);
  const log = $("scanLog");
  if (!line) {
    const known = findByBarcode(c);
    logScan(log, known ? `⚠️ ${esc(known.name)} isn't on this order` : `⚠️ Unknown barcode ${esc(c)}`, "bad");
    return;
  }
  scanned[o.id] ||= {};
  const got = (scanned[o.id][line.id] || 0) + 1;
  if (got > line.qty) { logScan(log, `⚠️ ${esc(line.name)} already fully picked (${line.qty})`, "bad"); return; }
  scanned[o.id][line.id] = got;
  render();
  logScan($("scanLog"), `✓ ${esc(line.name)} — ${got}/${line.qty}`, "good");
}
function logScan(el, html, cls) {
  if (!el) return;
  const d = document.createElement("div");
  d.className = "scan-line " + cls;
  d.innerHTML = html;
  el.prepend(d);
  while (el.children.length > 4) el.lastChild.remove();
}

async function startCamera() {
  if (!("BarcodeDetector" in window)) { toast("This browser can't scan with the camera — use a handheld scanner", "📷"); return; }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch { toast("Camera permission denied", "⚠️"); return; }
  render();
  const video = $("scanVideo");
  video.srcObject = cameraStream;
  await video.play();
  const detector = new BarcodeDetector({ formats: ["ean_13","ean_8","code_128","upc_a","upc_e","code_39"] });
  let last = "", lastAt = 0;
  const tick = async () => {
    if (!cameraStream) return;
    try {
      const codes = await detector.detect(video);
      if (codes.length) {
        const v = codes[0].rawValue, now = Date.now();
        if (v !== last || now - lastAt > 1600) { last = v; lastAt = now; handleScan(v); }
      }
    } catch { /* frame not ready */ }
    if (cameraStream) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function stopCamera() {
  if (!cameraStream) return;
  cameraStream.getTracks().forEach(t => t.stop());
  cameraStream = null;
}

/* ---------------- short ship ---------------- */
function shortDialog(orderId) {
  const o = getOrder(orderId);
  showModal(`<div class="co">
    <h3>Short ship ${o.id}</h3>
    <p class="co-sub">Enter how many cases are actually going out. Anything left outstanding keeps the order open and is shown on the delivery note.</p>
    <div class="table-wrap compact"><table class="tbl">
      <thead><tr><th>Product</th><th class="ta-c">Ordered</th><th class="ta-c">Sending</th></tr></thead>
      <tbody>${o.lines.map(l => `<tr>
        <td><b>${esc(l.name)}</b><small>${esc(l.unit)}</small></td>
        <td class="ta-c">${l.qty}</td>
        <td class="ta-c"><input class="mini-num" type="number" min="0" max="${l.qty}" value="${l.sent ?? l.qty}" data-sent="${l.id}"></td>
      </tr>`).join("")}</tbody>
    </table></div>
    <div class="co-nav"><button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" id="confirmShort">Confirm dispatch</button></div>
  </div>`);
  $("confirmShort").onclick = () => {
    const map = {};
    document.querySelectorAll("[data-sent]").forEach(i => map[i.dataset.sent] = i.value);
    const res = dispatchPartial(orderId, map, asAdmin ? "admin" : "warehouse");
    closeModal(); render();
    toast(res.outstanding ? `Part-dispatched — ${res.outstanding} cases outstanding` : "Order dispatched in full", "🚚");
  };
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
addEventListener("beforeunload", stopCamera);

render();
