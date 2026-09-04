/* ============ GROCERY — login ============ */
const $ = id => document.getElementById(id);
mountLogos();

// The ERP sends staff back here with ?logout=1 to end the session, because
// it runs on a different origin and cannot clear this one's storage itself.
// A hash rather than a query string: the static host drops queries when it
// redirects /login.html to /login.
if (location.hash === "#logout" || new URLSearchParams(location.search).has("logout")) {
  void logout();
  history.replaceState(null, "", location.pathname + "#admin");
  setTimeout(() => toast("Signed out", "\u{1F44B}"), 100);
}

const TABS = ["vendor", "admin", "warehouse"];
function switchTab(tab) {
  document.querySelectorAll(".auth-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  TABS.forEach(t => $(t + "Form").hidden = t !== tab);
}
document.querySelectorAll(".auth-tab").forEach(b => b.onclick = () => switchTab(b.dataset.tab));

// Hash is used as well as ?next= because some static hosts drop the query on clean-URL redirects.
const next = new URLSearchParams(location.search).get("next") || location.hash.replace("#", "");
if (TABS.includes(next)) switchTab(next);

const showError = (el, msg) => { el.textContent = msg; el.hidden = false; };

function submit(formId, errorId, fn, dest, welcome) {
  $(formId).onsubmit = async e => {
    e.preventDefault();
    const err = $(errorId); err.hidden = true;
    const [email, pass, remember] = fn.fields.map(id => $(id));
    if (!email.value.trim() || !pass.value.trim()) return showError(err, "Enter your email and password.");

    const btn = e.target.querySelector("button[type=submit]");
    const label = btn.innerHTML;
    btn.disabled = true; btn.textContent = "Signing in\u2026";
    const res = await fn.run(email.value, pass.value, remember.checked);
    btn.disabled = false; btn.innerHTML = label;

    if (!res.ok) return showError(err, res.error);
    toast(welcome(res), "\u{1F44B}");
    setTimeout(() => location.href = dest, 500);
  };
}

submit("vendorForm", "vendorError",
  { fields:["v-email","v-pass","v-remember"], run:loginVendor },
  "index.html", res => `Welcome back, ${esc(res.vendor.shopName || res.vendor.name)}`);

// Admin is the Warehouse ERP: sign in here, land on the ERP dashboard.
submit("adminForm", "adminError",
  { fields:["a-email","a-pass","a-remember"], run:(e,p,r) => loginAdmin(e,p,r) },
  ERP_BASE, () => "Opening the warehouse system\u2026");

submit("warehouseForm", "warehouseError",
  { fields:["w-email","w-pass","w-remember"], run:(e,p,r) => loginWarehouse(e,p,r) },
  "warehouse.html", () => "Signed in to the warehouse");
