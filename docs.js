/* ==========================================================
   GROCERY — printable documents
   Invoice, delivery note and pick list. Opened in a new window
   with their own print stylesheet, independent of the app theme.
   ========================================================== */

const DOC_CSS = `
  *{box-sizing:border-box}
  body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#111;margin:0;padding:32px;font-size:13px;line-height:1.5}
  .head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:18px;border-bottom:2px solid #111}
  .brand{font-size:22px;font-weight:800;letter-spacing:-.5px;color:#047857}
  .co{color:#555;font-size:11.5px;margin-top:5px;line-height:1.6}
  .doc-type{text-align:right}
  .doc-type h1{margin:0;font-size:24px;letter-spacing:-.5px;text-transform:uppercase}
  .doc-type .ref{color:#555;font-size:12px;margin-top:4px;line-height:1.7}
  .parties{display:flex;gap:32px;margin:22px 0}
  .parties>div{flex:1}
  .parties h3{margin:0 0 6px;font-size:10.5px;text-transform:uppercase;letter-spacing:.09em;color:#666}
  .parties b{font-size:14px}
  .parties p{margin:3px 0 0;color:#444;line-height:1.6}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th{text-align:left;border-bottom:2px solid #111;padding:9px 6px;font-size:10.5px;text-transform:uppercase;letter-spacing:.07em}
  td{border-bottom:1px solid #e3e3e3;padding:10px 6px;vertical-align:top}
  .num{text-align:right;white-space:nowrap}
  .totals{margin-left:auto;width:290px;margin-top:14px}
  .totals div{display:flex;justify-content:space-between;padding:6px 0;color:#444}
  .totals .grand{border-top:2px solid #111;margin-top:6px;padding-top:10px;font-size:16px;font-weight:800;color:#111}
  .disc{color:#047857}
  .note{margin-top:22px;padding:11px 14px;background:#f6f8f7;border-left:3px solid #047857;font-size:12px}
  .foot{margin-top:34px;padding-top:14px;border-top:1px solid #ddd;color:#666;font-size:11px;display:flex;justify-content:space-between;gap:20px}
  .box{width:18px;height:18px;border:2px solid #111;border-radius:3px;display:inline-block}
  .sig{margin-top:30px;display:flex;gap:36px}
  .sig div{flex:1;border-top:1px solid #999;padding-top:6px;color:#666;font-size:11px}
  .short{color:#b45309;font-weight:700}
  .pill{display:inline-block;border:1px solid #999;border-radius:99px;padding:1px 8px;font-size:10.5px;color:#555}
  @media print{body{padding:0}.noprint{display:none}}
  .noprint{margin-bottom:20px}
  .noprint button{font:inherit;padding:9px 18px;border-radius:7px;border:1px solid #047857;background:#047857;color:#fff;font-weight:600;cursor:pointer}
  .noprint button.alt{background:#fff;color:#047857}
`;

function openDoc(title, bodyHtml) {
  const w = window.open("", "_blank", "width=860,height=1000");
  if (!w) { toast("Allow pop-ups to open printable documents", "⚠️"); return null; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>${DOC_CSS}</style></head><body>
    <div class="noprint"><button onclick="window.print()">Print / Save as PDF</button>
      <button class="alt" onclick="window.close()">Close</button></div>
    ${bodyHtml}</body></html>`);
  w.document.close();
  w.focus();
  return w;
}

const docHead = (type, refLines) => {
  const c = getSettings().company;
  return `<div class="head">
    <div>
      <div class="brand">GROCERY</div>
      <div class="co"><b>${esc(c.name)}</b><br>${esc(c.address)}<br>
        ${esc(c.email)} · ${esc(c.phone)}<br>
        VAT ${esc(c.vat)} · Company ${esc(c.reg)}</div>
    </div>
    <div class="doc-type"><h1>${type}</h1><div class="ref">${refLines}</div></div>
  </div>`;
};

const partyBlock = o => `<div class="parties">
  <div><h3>Billed to</h3><b>${esc(o.vendorShop)}</b>
    <p>${esc(o.vendorName)}<br>${o.vendorAddress ? esc(o.vendorAddress) + "<br>" : ""}${esc(o.vendorEmail || "")}<br>${esc(o.vendorPhone || "")}</p></div>
  <div><h3>Account</h3><b>${esc(o.vendorId)}</b>
    <p>Pricing tier ${esc(o.tier)}<br>Discount applied ${o.discountPct}%</p></div>
</div>`;

/* ---------------- INVOICE ---------------- */
function printInvoice(orderId) {
  const o = getOrder(orderId);
  if (!o) return;
  const sentLines = o.lines.filter(l => (l.sent ?? l.qty) > 0);
  const billed = sentLines.reduce((s, l) => s + l.net * (l.sent ?? l.qty), 0);
  const grossBilled = sentLines.reduce((s, l) => s + l.list * (l.sent ?? l.qty), 0);
  const partial = o.lines.some(l => (l.sent ?? l.qty) < l.qty);

  openDoc(`Invoice ${o.invoiceNo || o.id}`, `
    ${docHead("Invoice", `
      <b>${esc(o.invoiceNo || o.id)}</b><br>
      Order ${esc(o.id)}<br>
      Date ${new Date(o.placedAt).toLocaleDateString("en-GB")}<br>
      Terms: 30 days net`)}
    ${partyBlock(o)}
    ${partial ? `<p class="pill">Partial invoice — billed for goods dispatched</p>` : ""}
    <table><thead><tr>
      <th>Product</th><th>Pack</th><th class="num">Qty</th><th class="num">List</th>
      <th class="num">Unit price</th><th class="num">Total</th>
    </tr></thead><tbody>
      ${sentLines.map(l => {
        const q = l.sent ?? l.qty;
        return `<tr><td><b>${esc(l.name)}</b>${l.barcode ? `<br><span style="color:#777;font-size:11px">${esc(l.barcode)}</span>` : ""}</td>
          <td>${esc(l.unit)}</td><td class="num">${q}</td>
          <td class="num" style="color:#888">${money(l.list)}</td>
          <td class="num">${money(l.net)}</td>
          <td class="num"><b>${money(l.net * q)}</b></td></tr>`;
      }).join("")}
    </tbody></table>
    <div class="totals">
      <div><span>Goods at list price</span><span>${money(grossBilled)}</span></div>
      <div class="disc"><span>Trade discount (Tier ${esc(o.tier)})</span><span>−${money(grossBilled - billed)}</span></div>
      <div><span>Delivery</span><span>FREE</span></div>
      <div class="grand"><span>Total due</span><span>${money(billed)}</span></div>
    </div>
    ${o.note ? `<div class="note"><b>Order note:</b> ${esc(o.note)}</div>` : ""}
    <div class="foot">
      <span>Payment within 30 days to ${esc(getSettings().company.name)}. Please quote ${esc(o.invoiceNo || o.id)}.</span>
      <span>Prices exclude VAT where applicable.</span>
    </div>`);
}

/* ---------------- DELIVERY NOTE ---------------- */
function printDeliveryNote(orderId) {
  const o = getOrder(orderId);
  if (!o) return;
  openDoc(`Delivery note ${o.id}`, `
    ${docHead("Delivery Note", `
      <b>${esc(o.id)}</b><br>
      Date ${new Date().toLocaleDateString("en-GB")}<br>
      Ordered ${new Date(o.placedAt).toLocaleDateString("en-GB")}`)}
    <div class="parties">
      <div><h3>Deliver to</h3><b>${esc(o.vendorShop)}</b>
        <p>${esc(o.vendorName)}<br>${o.vendorAddress ? esc(o.vendorAddress) + "<br>" : ""}${esc(o.vendorPhone || "")}</p></div>
      <div><h3>Account</h3><b>${esc(o.vendorId)}</b><p>${o.lines.reduce((s,l)=>s+(l.sent ?? l.qty),0)} cases in this delivery</p></div>
    </div>
    <table><thead><tr>
      <th>Product</th><th>Pack</th><th class="num">Ordered</th><th class="num">Delivered</th><th class="num">Outstanding</th>
    </tr></thead><tbody>
      ${o.lines.map(l => {
        const sent = l.sent ?? l.qty, out = l.qty - sent;
        return `<tr><td><b>${esc(l.name)}</b></td><td>${esc(l.unit)}</td>
          <td class="num">${l.qty}</td><td class="num"><b>${sent}</b></td>
          <td class="num ${out ? "short" : ""}">${out || "—"}</td></tr>`;
      }).join("")}
    </tbody></table>
    ${o.note ? `<div class="note"><b>Order note:</b> ${esc(o.note)}</div>` : ""}
    <p style="margin-top:20px;color:#555;font-size:12px">Please check goods on receipt. Report shortages or damages within 48 hours.</p>
    <div class="sig">
      <div>Received by (print name)</div><div>Signature</div><div>Date</div>
    </div>
    <div class="foot"><span>${esc(getSettings().company.name)} — no prices shown on delivery documentation.</span><span>${esc(o.id)}</span></div>`);
}

/* ---------------- PICK LIST ---------------- */
function printPickList(orderId) {
  const o = getOrder(orderId);
  if (!o) return;
  openDoc(`Pick list ${o.id}`, `
    ${docHead("Pick List", `
      <b>${esc(o.id)}</b><br>
      ${esc(o.vendorShop)}<br>
      Received ${new Date(o.placedAt).toLocaleString("en-GB")}`)}
    <table><thead><tr>
      <th style="width:34px">✓</th><th>Product</th><th>Barcode</th><th>Pack</th><th class="num">Qty</th>
    </tr></thead><tbody>
      ${o.lines.map(l => `<tr>
        <td><span class="box"></span></td>
        <td><b>${esc(l.name)}</b></td>
        <td style="color:#666">${esc(l.barcode || "—")}</td>
        <td>${esc(l.unit)}</td>
        <td class="num" style="font-size:17px;font-weight:800">${l.qty}</td></tr>`).join("")}
    </tbody></table>
    ${o.note ? `<div class="note"><b>Order note:</b> ${esc(o.note)}</div>` : ""}
    <div class="sig"><div>Picked by</div><div>Checked by</div><div>Date</div></div>
    <div class="foot"><span>Total ${o.lines.reduce((s,l)=>s+l.qty,0)} cases across ${o.lines.length} lines.</span><span>${esc(o.id)}</span></div>`);
}
