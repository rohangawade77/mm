# GROCERY — B2B Wholesale Platform

A clean, professional trade-only ecommerce front end. Products are public; **prices are not**. Visitors apply for a wholesale account, an admin approves them and assigns a discount tier, and pricing unlocks on sign-in.

The interface is a light, business-tool theme — white surfaces, a deep emerald brand colour, and restrained typography, with the three vendor tiers colour-coded (A indigo, B amber, C slate) so they're distinguishable at a glance.

**Dark theme:** the ☀️/🌙 button in every header toggles it. The choice is remembered across pages and sessions; until you pick one, the site follows your operating system setting and updates live if that changes.

## Run it

```bash
npx serve -l 4519 .
```

Then open http://localhost:4519

## Demo credentials

| Role | Email | Password | Tier |
|---|---|---|---|
| Admin | `admin@grocery.com` | `admin@123` | — |
| Warehouse | `warehouse@grocery.com` | `pack@123` | — |
| Vendor | `amrit@singhs.co.uk` | `GR-4821` | A (30%) |
| Vendor | `priya@patelbros.com` | `GR-7734` | B (20%) |

Two applications ship in a pending state so the approval queue isn't empty.

## How pricing works

Each product has one **list price**. A vendor's tier sets the discount applied to that list price everywhere they see it — catalogue, quick view, cart, order totals and their personal price list.

| Tier | Default discount | Intended for |
|---|---|---|
| A — Platinum | 30% | Top-volume national accounts |
| B — Gold | 20% | Established multi-store retailers |
| C — Silver | 10% | Independent single-store retailers |

The three percentages are **editable in the admin panel** (Tier Discounts). Changing one instantly reprices every vendor on that tier.

Public visitors see a padlock and "Sign in to view" instead of any price.

## Flow

1. Visitor submits the application form on the home page (name, shop name, email, phone).
2. It lands in **Admin → Applications** as pending.
3. Admin clicks tier **A**, **B** or **C** to approve, or rejects it.
4. Approval generates a trade password (`AZ-####`) shown to the admin to pass to the vendor.
5. Vendor signs in at `login.html`, sees tier pricing, and can order.
6. Orders appear in **Admin → Orders** with a status dropdown.

## Managing products

**Admin → Products** lists every line with its list price and the resulting Tier A/B/C price. From there you can:

- **Add product** — name, brand, category, list price, pack, MOQ, stock, barcode, image, badge, description.
- **Product images** — upload a JPG or PNG and it's downscaled to a 400px thumbnail before storing. Products with no image fall back to their emoji. Because images live in `localStorage` (~5MB total), a storage meter appears in Products and Settings once you pass 60% — keep photos to the lines that matter.
- **Edit / Delete** — per row. Deleting removes it from the catalogue; past orders keep their own snapshot of what was bought.
- **Export** — download the current view as CSV.
- **Import** — bulk add and update from a spreadsheet.

### Spreadsheet import

Upload an **.xlsx** or **.csv** file. The first row must be column headings. You get a preview of the mapped columns and the first few rows before anything is committed.

Matching rule: a row updates an existing product if its `id` matches, or failing that if its `name` matches exactly (case-insensitive). Otherwise it is added as a new product.

Recognised columns — common variations are matched automatically, so a real supplier price list usually works untouched:

| Field | Also accepts |
|---|---|
| `name` | product, product name, title, item |
| `brand` | manufacturer, supplier, make |
| `category` | cat, type, department, group |
| `list` | price, list price, rate, cost, unit price, wholesale price |
| `unit` | pack, pack size, case, case size, packing, uom |
| `moq` | min, min order, minimum, min qty |
| `stock` | qty, quantity, available, on hand, inventory |
| `emoji` | icon, image |
| `flags` | tags, label, badge (values: `best`, `new`) |
| `description` | desc, details, notes, about |
| `id` | sku, code, product id, product code |

Use **Download template** in the import dialog to get a correctly-headed starter file. The `.xlsx` reader is built in — no external library — using the browser's native decompression.

## Sorting and downloads

Every column heading in the Customers, Orders and Products tables is clickable to sort; click again to reverse. Search and status filters narrow the rows, and the sort/filter you're looking at is what the "View" download gives you.

- **Customers** → download the filtered view, or all customers (includes tier, discount %, trade password, dates).
- **Orders** → download the filtered view, all orders, or **line items** (one row per product — a picking/reconciliation sheet).
- **Products** → export the current view.

CSVs are written with a BOM so Excel opens `£` and accented characters correctly.

## Quick order pad

`orderpad.html` — keyboard-first bulk entry for repeat buyers. Type a few letters (or scan a barcode), <kbd>Enter</kbd> to pick, type the quantity, <kbd>Enter</kbd> again to drop onto a new line. Live unit price, line total and order total update as you go, including any volume break earned.

The same page lists recent orders with **Load into pad**, and every order in the vendor's account history has a **↻ Reorder** button that refills the basket, capping each line at what's actually in stock and telling you what it adjusted.

## Stock

Stock is live. Placing an order decrements it, editing an order returns the difference, and out-of-stock lines can't be added — the catalogue greys them out and the cart refuses to exceed what's on hand. The low-stock threshold is set in **Settings** and drives both the dashboard panel and the "only N left" warnings.

## Volume breaks

Set in **Pricing**: extra discount once a single line reaches a quantity, added to the tier rate. Defaults are 10+ cases −3%, 25+ −5%, 50+ −8%.

So a Tier A customer (30%) buying 25 cases pays 35% off. The product quick view nudges the next threshold ("order 25+ for an extra 5%"), and the cart shows how much of the saving came from volume.

## Per-customer special prices

On a customer's detail page you can fix a price for specific products. It overrides their tier and any volume break, and is labelled "Agreed price" wherever that customer sees it.

## Documents

Printable invoice, delivery note and pick list per order, using the company details from **Settings**. Open from the admin order view, the warehouse card, or the vendor's own order history.

- **Invoice** bills only what was actually dispatched — part-shipped orders produce a partial invoice.
- **Delivery note** shows ordered / delivered / outstanding, with no prices.
- **Pick list** is a tick-box picking sheet with barcodes.

## Order editing & part-dispatch

Admin can amend line quantities on a placed order (stock adjusts automatically) and dispatch short — outstanding cases keep the order open with a `partial` status and appear on the delivery note.

## Warehouse portal

`warehouse.html` — a fulfilment-only view for packing staff. It shows **no pricing at all**, only what needs picking.

Each order is a card with its picking list and case quantities, and a single button advancing it through **received → packing → packed → dispatched** (with a "back" button if someone taps too far). Filters cover each status plus an "Open" queue, and the list sorts by date, order number, business, case count or status.

**Admins reach this page directly** from the sidebar — no second login. A banner confirms you're viewing as admin and the sign-out button becomes "Back to admin".

**Barcode scanning:** hit *Scan* on an order to open scan mode. A handheld wedge scanner works out of the box (it types the code and presses Enter), and on browsers with `BarcodeDetector` you can use the device camera instead. Each scan ticks off a case, the progress bar tracks cases picked, and scanning something that isn't on the order says so by name. Lines go struck-through once fully picked.

**Short shipping:** the *Short ship* button lets you enter what's actually going out per line.

Status changes made here appear immediately in the admin Orders table, and each change is stamped with who made it.

## Files

| File | Purpose |
|---|---|
| `index.html` / `main.js` | Public storefront + application form + tier-aware cart |
| `login.html` / `auth.js` | Vendor, admin and warehouse sign-in (tabbed) |
| `admin.html` / `admin.js` | Dashboard, analytics, applications, customers, orders, products, pricing, settings |
| `warehouse.html` / `warehouse.js` | Fulfilment queue, barcode scanning, status updates, short shipping |
| `vendor.html` / `vendor.js` | Vendor account, order history, reorder, personal price list |
| `orderpad.html` / `orderpad.js` | Keyboard-first quick order pad |
| `store.js` | Catalogue, data layer, auth, pricing, stock, cart, orders, analytics, CSV export |
| `sheet.js` | Dependency-free `.xlsx` / `.csv` reader and column mapping |
| `docs.js` | Printable invoice, delivery note and pick list |
| `styles.css` | Full theme |
| `assets/logo.svg` | Logo |

## Important: this is a front-end prototype

All data — accounts, passwords, tiers, products, orders — lives in the browser's `localStorage`, and all checks run in JavaScript on the client. Data is per-browser: products you add on one machine won't appear on another, and clearing site data resets everything to the seed catalogue.

That means **the price gate is cosmetic, not secure**. Anyone can open devtools and read the catalogue, list prices and vendor passwords, or grant themselves a tier. It's the right shape for demos, stakeholder review and pinning down the workflow — it is not safe for real trade pricing or real customer data.

To make it real you need a server: a database for vendors/orders, hashed passwords, session tokens, and an API that only returns prices to an authenticated approved account. The client code is structured so `store.js` is the single seam to swap for API calls.
