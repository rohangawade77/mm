/* ============ GROCERY — My Account ============
   Order history, one order in full, account details and a password change.
   Everything here comes from the ERP; nothing about the account is stored
   in this browser except the session token.                              */
requireVendor();
const $ = id => document.getElementById(id);
mountLogos();

let ORDERS = [];
let RETURNS = [];
let ADDRESS = null;
let openOrder = null;

/* The account page opens with the recent handful; the rest is one click away. */
const ORDERS_SHOWN = 5;
let showAllOrders = false;

const penceMoney = p => money((p || 0) / 100);
const docLabel = t => ({ QUOTE:"Quote", PROFORMA:"Proforma", INVOICE:"Invoice", CREDIT_NOTE:"Credit note" }[t] || t);
const returnStatusClass = s => ({
  REQUESTED: "packing", APPROVED: "packed", COMPLETED: "delivered", REJECTED: "rejected",
}[s] || "received");
const statusClass = s => ({ OPEN:"received", PAID:"delivered", PART_PAID:"packing", DRAFT:"packed", CANCELLED:"rejected" }[s] || "received");

/* What the warehouse is doing with it, which is what a customer actually asks. */
const STAGE_LABEL = {
  PENDING: "Received", PROCESSING: "Being picked", PACKED: "Packed",
  ALLOCATED: "Out for delivery", DELIVERED: "Delivered",
};
const stageClass = s => ({
  PENDING:"received", PROCESSING:"packing", PACKED:"packed",
  ALLOCATED:"packing", DELIVERED:"delivered",
}[s] || "received");
const stageOf = o => o.delivery?.status || null;

async function boot() {
  await loadSession();
  const v = currentVendor();
  if (!v) { location.href = "login.html"; return; }
  await loadCatalogue();
  const [o, r, a] = await Promise.all([myOrders(), myReturns(), myAddress()]);
  ORDERS = o; RETURNS = r; ADDRESS = a.ok ? a.address : null;
  render(v);
  watchForUpdates(v);
}

function render(v) {
  $("roleChip").textContent = "TRADE ACCOUNT";
  $("roleChip").className = "role-chip";
  $("logoutBtn").onclick = async () => { await logout(); location.href = "index.html"; };

  const outstanding = ORDERS
    .filter(o => o.type === "INVOICE" && ["OPEN", "PART_PAID"].includes(o.status))
    .reduce((s, o) => s + (o.grossPence - o.paidPence), 0);

  $("vendorMain").innerHTML = `
    <div class="page-head detail-head">
      <div><h1>${esc(v.shopName || v.name)}</h1>
        <p>Account ${esc(v.code)}${v.contactName ? " · " + esc(v.contactName) : ""}</p></div>
      <a class="btn btn-primary" href="index.html">Browse products</a>
    </div>

    ${v.mustChangePassword ? `<div class="banner lock" style="margin-bottom:1.2rem">
      <span class="banner-ico">🔑</span>
      <div><b>Please change your password</b>
      <small>You are still using the password we issued. Set your own below.</small></div></div>` : ""}

    <div class="stat-grid">
      <div class="stat-card"><span class="stat-ico">📦</span><b>${ORDERS.length}</b><small>Orders placed</small></div>
      <div class="stat-card ${outstanding ? "action" : ""}"><span class="stat-ico">🧾</span><b>${penceMoney(outstanding)}</b><small>Outstanding</small></div>
      <div class="stat-card"><span class="stat-ico">📅</span><b>${v.paymentTermsDays}d</b><small>Payment terms</small></div>
    </div>

    <section class="panel">
      <div class="panel-head">
        <h2>Order history</h2>
        ${ORDERS.length > ORDERS_SHOWN
          ? `<span class="muted sm">Showing ${showAllOrders ? ORDERS.length : Math.min(ORDERS_SHOWN, ORDERS.length)} of ${ORDERS.length}</span>`
          : ""}
      </div>
      ${ORDERS.length ? `<div class="table-wrap"><table class="tbl">
        <thead><tr><th>Document</th><th>Date</th><th>Items</th><th class="ta-r">Net</th><th class="ta-r">VAT</th><th class="ta-r">Total</th><th>Progress</th><th></th></tr></thead>
        <tbody>${visibleOrders().map(o => `<tr>
          <td><b>${esc(o.number)}</b><small>${docLabel(o.type)}</small></td>
          <td><small>${new Date(o.issuedAt).toLocaleDateString("en-GB")}</small></td>
          <td>${o.lines.reduce((s,l)=>s+l.qtyCases,0)} cases<small>${o.lines.length} lines</small></td>
          <td class="ta-r">${penceMoney(o.netPence)}</td>
          <td class="ta-r muted">${penceMoney(o.vatPence)}</td>
          <td class="ta-r"><b>${penceMoney(o.grossPence)}</b></td>
          <td>${stageOf(o)
            ? `<span class="status ${stageClass(stageOf(o))}">${esc(STAGE_LABEL[stageOf(o)] || stageOf(o).toLowerCase())}</span>`
            : `<span class="status received">received</span>`}
            <small class="muted">${o.status.replace("_"," ").toLowerCase()}</small></td>
          <td class="row-actions">
            <button class="btn btn-ghost sm" data-open="${esc(o.number)}">View</button>
            <a class="btn btn-ghost sm" href="${documentUrl(o.id)}" target="_blank" rel="noopener">Invoice</a>
          </td>
        </tr>`).join("")}</tbody></table></div>
        ${ORDERS.length > ORDERS_SHOWN ? `<div class="more-row">
          <button class="btn btn-ghost" id="toggleOrders">
            ${showAllOrders
              ? "Show fewer"
              : `Show all ${ORDERS.length} orders`}
          </button>
        </div>` : ""}`
        : `<div class="empty-inline">No orders yet. <a href="index.html">Browse the range →</a></div>`}
    </section>

    ${RETURNS.length ? `<section class="panel">
      <div class="panel-head"><h2>Returns</h2></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>Reference</th><th>Order</th><th>Raised</th><th>Items</th><th>Reason</th><th>Status</th><th class="ta-r">Credited</th></tr></thead>
        <tbody>${RETURNS.map(r => `<tr>
          <td><b>${esc(r.number)}</b></td>
          <td><small>${esc(r.orderNumber)}</small></td>
          <td><small>${new Date(r.requestedAt).toLocaleDateString("en-GB")}</small></td>
          <td>${r.lines.length} line${r.lines.length === 1 ? "" : "s"}</td>
          <td><small>${esc(r.reason)}</small>${r.reviewNote ? `<small class="muted">${esc(r.reviewNote)}</small>` : ""}</td>
          <td><span class="status ${returnStatusClass(r.status)}">${r.status.toLowerCase()}</span></td>
          <td class="ta-r">${r.creditNote
            ? `<b>${penceMoney(r.creditPence)}</b>
               <small><a href="${documentUrl(r.creditNoteId)}" target="_blank" rel="noopener">${esc(r.creditNote)}</a></small>`
            : `<span class="muted">—</span>`}</td>
        </tr>`).join("")}</tbody>
      </table></div>
    </section>` : ""}

    <div class="two-col">
      <section class="panel">
        <div class="panel-head"><h2>Account details</h2></div>
        <dl class="kv wide">
          <div><dt>Business</dt><dd>${esc(v.shopName || v.name)}</dd></div>
          <div><dt>Account code</dt><dd>${esc(v.code)}</dd></div>
          <div><dt>Contact</dt><dd>${esc(v.contactName || "—")}</dd></div>
          <div><dt>Email</dt><dd>${esc(v.email)}</dd></div>
          <div><dt>Phone</dt><dd>${esc(v.phone || "—")}</dd></div>
          <div><dt>Payment terms</dt><dd>${v.paymentTermsDays} days</dd></div>
        </dl>
        <p class="muted sm">To change any of these, contact your account manager.</p>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Delivery address</h2></div>
        <div class="co-fields">
          <div class="full-w"><label>Address line 1</label>
            <input id="ad-1" value="${esc(ADDRESS?.line1 || "")}" placeholder="Unit 4, Beaumont Industrial Estate"></div>
          <div class="full-w"><label>Address line 2</label>
            <input id="ad-2" value="${esc(ADDRESS?.line2 || "")}" placeholder="Optional"></div>
          <div><label>Town / city</label>
            <input id="ad-city" value="${esc(ADDRESS?.city || "")}" placeholder="Leicester"></div>
          <div><label>Postcode</label>
            <input id="ad-pc" value="${esc(ADDRESS?.postcode || "")}" placeholder="LE4 9HR" style="text-transform:uppercase"></div>
        </div>
        <div id="ad-msg"></div>
        <div class="co-nav"><button class="btn btn-primary" id="ad-save">Save address</button></div>
        <p class="muted sm">Used for every future delivery. Orders already loaded onto a van
          keep the address they were planned with.</p>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Change password</h2></div>
        <div class="co-fields">
          <div class="full-w"><label>Current password</label><input id="pw-current" type="password" autocomplete="current-password"></div>
          <div class="full-w"><label>New password</label><input id="pw-next" type="password" autocomplete="new-password" placeholder="At least 6 characters"></div>
          <div class="full-w"><label>Confirm new password</label><input id="pw-confirm" type="password" autocomplete="new-password"></div>
        </div>
        <div id="pw-msg"></div>
        <div class="co-nav"><button class="btn btn-primary" id="pw-save">Update password</button></div>
      </section>
    </div>`;

  document.querySelectorAll("[data-open]").forEach(b => b.onclick = () => showOrder(b.dataset.open));
  if ($("toggleOrders")) {
    $("toggleOrders").onclick = () => { showAllOrders = !showAllOrders; render(v); };
  }
  $("pw-save").onclick = doChangePassword;
  if ($("ad-save")) $("ad-save").onclick = doSaveAddress;
}

async function doSaveAddress() {
  const msg = $("ad-msg");
  const btn = $("ad-save");
  btn.disabled = true; btn.textContent = "Saving…";

  const out = await saveMyAddress({
    line1: $("ad-1").value.trim(),
    line2: $("ad-2").value.trim(),
    city: $("ad-city").value.trim(),
    postcode: $("ad-pc").value.trim(),
  });

  btn.disabled = false; btn.textContent = "Save address";
  if (!out.ok) { msg.innerHTML = `<div class="msg bad">${esc(out.error)}</div>`; return; }

  ADDRESS = out.address;
  msg.innerHTML = `<div class="msg good">Address saved. Future deliveries will go here.</div>`;
  toast("Delivery address updated", "\u{1F4CD}");
}

/* Newest first, trimmed unless the customer has asked for the lot. */
function visibleOrders() {
  const sorted = [...ORDERS].sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
  return showAllOrders ? sorted : sorted.slice(0, ORDERS_SHOWN);
}

/* ---------------- one order in full ---------------- */
function showOrder(number) {
  const o = ORDERS.find(x => x.number === number);
  if (!o) return;
  openOrder = o;
  showModal(`<div class="co">
    <h3>${esc(o.number)}</h3>
    <p class="co-sub">${docLabel(o.type)} · issued ${new Date(o.issuedAt).toLocaleDateString("en-GB")}
      ${o.dueAt ? ` · due ${new Date(o.dueAt).toLocaleDateString("en-GB")}` : ""}
      · <span class="status ${statusClass(o.status)}">${o.status.replace("_"," ").toLowerCase()}</span></p>

    <div class="table-wrap compact"><table class="tbl">
      <thead><tr><th>Product</th><th class="ta-c">Cases</th><th class="ta-r">Unit</th><th class="ta-r">Net</th><th class="ta-r">VAT</th></tr></thead>
      <tbody>${o.lines.map(l => `<tr>
        <td><b>${esc(l.description)}</b></td>
        <td class="ta-c">${l.qtyCases}${l.qtyLoose ? ` + ${l.qtyLoose}` : ""}</td>
        <td class="ta-r">${penceMoney(l.unitPricePence)}</td>
        <td class="ta-r">${penceMoney(l.netPence)}</td>
        <td class="ta-r muted">${penceMoney(l.vatPence)}</td></tr>`).join("")}</tbody>
    </table></div>

    <div class="co-summary">
      <div class="row"><span>Net</span><span>${penceMoney(o.netPence)}</span></div>
      <div class="row"><span>VAT</span><span>${penceMoney(o.vatPence)}</span></div>
      <div class="row total"><span>Total</span><span>${penceMoney(o.grossPence)}</span></div>
      ${o.paidPence ? `<div class="row"><span>Paid</span><span>${penceMoney(o.paidPence)}</span></div>
        <div class="row total"><span>Outstanding</span><span>${penceMoney(o.grossPence - o.paidPence)}</span></div>` : ""}
    </div>

    ${o.delivery ? `<p class="muted sm">Delivery ${esc(o.delivery.number)} · ${esc(o.delivery.method.toLowerCase())} · ${esc(o.delivery.status.toLowerCase())}</p>` : ""}
    ${o.notes ? `<div class="apply-note">${esc(o.notes)}</div>` : ""}

    <div class="co-nav">
      <a class="btn btn-ghost" href="${documentUrl(o.id)}" target="_blank" rel="noopener">Download invoice</a>
      ${o.type === "INVOICE" ? `<button class="btn btn-ghost" id="startReturn">Return items</button>` : ""}
      <button class="btn btn-primary" data-close>Close</button>
    </div>
  </div>`);

  if ($("startReturn")) $("startReturn").onclick = () => showReturnForm(o);
}

/* ---------------- ask to send something back ---------------- */
async function showReturnForm(o) {
  showModal(`<div class="co"><h3>Return items</h3>
    <p class="co-sub">Checking what can be returned…</p></div>`);

  const info = await returnableFor(o.id);
  if (!info.ok) { showModal(`<div class="co"><h3>Return items</h3>
    <p class="co-sub">${esc(info.error)}</p>
    <div class="co-nav"><button class="btn btn-primary" data-close>Close</button></div></div>`); return; }

  if (!info.eligible) {
    showModal(`<div class="co">
      <h3>Return items</h3>
      <div class="banner lock" style="margin:.6rem 0 1rem">
        <span class="banner-ico">⏳</span>
        <div><b>This order cannot be returned</b><small>${esc(info.reason || "")}</small></div>
      </div>
      <p class="muted sm">Returns are accepted within ${info.windowDays} days of delivery.
        If something is wrong, please call your account manager.</p>
      <div class="co-nav"><button class="btn btn-primary" data-close>Close</button></div></div>`);
    return;
  }

  const open = info.lines.filter(l => l.remainingUnits > 0);
  if (!open.length) {
    showModal(`<div class="co"><h3>Return items</h3>
      <p class="co-sub">Everything on ${esc(o.number)} has already been requested for return.</p>
      <div class="co-nav"><button class="btn btn-primary" data-close>Close</button></div></div>`);
    return;
  }

  showModal(`<div class="co">
    <h3>Return items from ${esc(o.number)}</h3>
    <p class="co-sub">Tick what you are sending back and say how many. We will review it and
      raise a credit note once accepted.</p>

    <div class="table-wrap compact"><table class="tbl">
      <thead><tr><th></th><th>Product</th><th class="ta-c">Delivered</th><th class="ta-c">Returning</th><th>What is wrong</th></tr></thead>
      <tbody>${open.map(l => `<tr>
        <td><input type="checkbox" class="ret-pick" data-line="${esc(l.id)}"></td>
        <td><b>${esc(l.description)}</b>${l.size ? `<small>${esc(l.size)}</small>` : ""}</td>
        <td class="ta-c">${l.remainingUnits}<small>units</small></td>
        <td class="ta-c">
          <input type="number" class="ret-qty" data-line="${esc(l.id)}"
                 min="1" max="${l.remainingUnits}" value="${l.remainingUnits}"
                 style="width:5rem;text-align:center">
        </td>
        <td><input type="text" class="ret-why" data-line="${esc(l.id)}"
                   placeholder="Optional" maxlength="200"></td>
      </tr>`).join("")}</tbody>
    </table></div>

    <div class="co-fields" style="margin-top:1rem">
      <div class="full-w">
        <label>Reason for the return</label>
        <select id="ret-reason">
          ${info.reasons.map(r => `<option>${esc(r)}</option>`).join("")}
        </select>
      </div>
      <div class="full-w">
        <label>Anything else we should know</label>
        <textarea id="ret-note" rows="2" maxlength="500" placeholder="Optional"></textarea>
      </div>
    </div>

    <div id="ret-msg"></div>
    <div class="co-nav">
      <button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-primary" id="ret-send">Send return request</button>
    </div>
  </div>`);

  // A quantity is only meaningful once the line is ticked.
  document.querySelectorAll(".ret-qty, .ret-why").forEach(el => {
    const pick = document.querySelector(`.ret-pick[data-line="${el.dataset.line}"]`);
    const sync = () => { el.disabled = !pick.checked; };
    pick.addEventListener("change", sync);
    sync();
  });

  $("ret-send").onclick = async () => {
    const lines = [...document.querySelectorAll(".ret-pick:checked")].map(p => ({
      salesLineId: p.dataset.line,
      qtyUnits: Number(document.querySelector(`.ret-qty[data-line="${p.dataset.line}"]`).value) || 0,
      reason: document.querySelector(`.ret-why[data-line="${p.dataset.line}"]`).value.trim() || undefined,
    })).filter(l => l.qtyUnits > 0);

    if (!lines.length) {
      $("ret-msg").innerHTML = `<div class="msg bad">Tick at least one item and give a quantity.</div>`;
      return;
    }

    $("ret-send").disabled = true;
    $("ret-send").textContent = "Sending…";
    const out = await requestReturn({
      docId: o.id,
      reason: $("ret-reason").value,
      note: $("ret-note").value.trim() || undefined,
      lines,
    });

    if (!out.ok) {
      $("ret-msg").innerHTML = `<div class="msg bad">${esc(out.error)}</div>`;
      $("ret-send").disabled = false;
      $("ret-send").textContent = "Send return request";
      return;
    }

    showModal(`<div class="co">
      <h3>Return ${esc(out.number)} received</h3>
      <p class="co-sub">Thank you — our team will review it and you will see a credit note
        on your account once it is accepted.</p>
      <div class="co-nav"><button class="btn btn-primary" data-close>Close</button></div></div>`);
    RETURNS = await myReturns();
    render(currentVendor());
  };
}

/* ---------------- password ---------------- */
async function doChangePassword() {
  const cur = $("pw-current").value, next = $("pw-next").value, conf = $("pw-confirm").value;
  const msg = $("pw-msg");
  const say = (text, bad) => msg.innerHTML =
    `<div class="import-status ${bad ? "err" : "ok"}">${bad ? "⚠️" : "✅"} ${esc(text)}</div>`;

  if (!cur || !next) return say("Fill in your current and new password.", true);
  if (next.length < 6) return say("Choose a password of at least 6 characters.", true);
  if (next !== conf) return say("The two new passwords do not match.", true);

  const btn = $("pw-save");
  btn.disabled = true; btn.textContent = "Saving…";
  const res = await changeMyPassword(cur, next);
  btn.disabled = false; btn.textContent = "Update password";

  if (!res.ok) return say(res.error, true);
  say("Password updated.", false);
  ["pw-current","pw-next","pw-confirm"].forEach(id => $(id).value = "");
  await loadSession();
  toast("Password updated", "🔑");
}

/* ---------------- modal ---------------- */
function showModal(html) {
  let overlay = $("modalOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "modalOverlay"; overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal" id="modal"></div>`;
    document.body.appendChild(overlay);
    overlay.onclick = e => { if (e.target === overlay) closeModal(); };
  }
  $("modal").innerHTML = html;
  overlay.classList.add("open");
  $("modal").querySelectorAll("[data-close]").forEach(b => b.onclick = closeModal);
}
const closeModal = () => $("modalOverlay")?.classList.remove("open");
addEventListener("keydown", e => e.key === "Escape" && closeModal());

boot();


/* ---------------- keep the page current ----------------
 * A status changed in the back office should show here without the customer
 * refreshing. The page re-reads while it is open, skips the check when the tab
 * is hidden, and only redraws when something has actually moved — so an address
 * half-typed into the form is never wiped by a background refresh.
 */
const POLL_MS = 20000;
let pollTimer = null;

function ordersFingerprint(list) {
  return list.map(o => `${o.number}:${o.status}:${o.delivery?.status || ""}`).join("|");
}

function watchForUpdates(v) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (document.hidden) return;
    // Not while a dialog is open, or the customer loses what they were reading.
    if ($("modalOverlay")?.classList.contains("open")) return;

    const [fresh, freshReturns] = await Promise.all([myOrders(), myReturns()]);
    if (!Array.isArray(fresh)) return;

    const moved = ordersFingerprint(fresh) !== ordersFingerprint(ORDERS);
    const returnsMoved = freshReturns.map(r => `${r.number}:${r.status}`).join("|")
                       !== RETURNS.map(r => `${r.number}:${r.status}`).join("|");
    if (!moved && !returnsMoved) return;

    // Hold on to anything typed into the address form across the redraw.
    const typed = $("ad-1") ? {
      line1: $("ad-1").value, line2: $("ad-2").value,
      city: $("ad-city").value, postcode: $("ad-pc").value,
    } : null;

    ORDERS = fresh; RETURNS = freshReturns;
    render(v);

    if (typed && $("ad-1")) {
      $("ad-1").value = typed.line1; $("ad-2").value = typed.line2;
      $("ad-city").value = typed.city; $("ad-pc").value = typed.postcode;
    }
    if (moved) toast("Your order status has been updated", "\u{1F4E6}");
  }, POLL_MS);
}
