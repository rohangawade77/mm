/* ==========================================================
   GROCERY — spreadsheet reader (.xlsx / .csv)

   No external library. An .xlsx file is a ZIP of XML parts, so we
   read the ZIP directory ourselves and inflate entries with the
   browser's native DecompressionStream.
   ========================================================== */

/* ---------------- ZIP ---------------- */
async function unzip(buffer) {
  const dv = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // End of central directory: scan back from the tail for its signature.
  let eocd = -1;
  for (let i = dv.byteLength - 22; i >= 0 && i > dv.byteLength - 65558; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("Not a valid .xlsx file (no ZIP directory found).");

  const count = dv.getUint16(eocd + 10, true);
  let ptr = dv.getUint32(eocd + 16, true);
  const files = {};

  for (let n = 0; n < count; n++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localOff = dv.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));

    // Local header repeats the name/extra lengths; payload starts after them.
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + compSize);

    files[name] = method === 0 ? raw : await inflateRaw(raw);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function")
    throw new Error("This browser can't unzip .xlsx files — please upload a CSV instead.");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ---------------- XLSX ---------------- */
const colToIndex = ref => {
  const letters = ref.match(/^[A-Z]+/i)?.[0] || "A";
  return [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
};

async function readXLSX(file) {
  const files = await unzip(await file.arrayBuffer());
  const text = name => files[name] ? new TextDecoder().decode(files[name]) : null;
  const parse = xml => new DOMParser().parseFromString(xml, "application/xml");

  // Shared strings table — most cell text lives here rather than inline.
  const shared = [];
  const ssXml = text("xl/sharedStrings.xml");
  if (ssXml) {
    parse(ssXml).querySelectorAll("si").forEach(si => {
      shared.push([...si.querySelectorAll("t")].map(t => t.textContent).join(""));
    });
  }

  const sheetName = Object.keys(files)
    .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort()[0];
  if (!sheetName) throw new Error("No worksheet found in this file.");

  const rows = [];
  parse(text(sheetName)).querySelectorAll("row").forEach(row => {
    const cells = [];
    row.querySelectorAll("c").forEach(c => {
      const idx = colToIndex(c.getAttribute("r") || "A");
      const type = c.getAttribute("t");
      let value = "";
      if (type === "s") value = shared[+c.querySelector("v")?.textContent] ?? "";
      else if (type === "inlineStr") value = c.querySelector("is")?.textContent ?? "";
      else value = c.querySelector("v")?.textContent ?? "";
      cells[idx] = value;
    });
    rows.push([...cells].map(v => v ?? ""));
  });
  return rows;
}

/* ---------------- CSV ---------------- */
function parseCSV(textContent) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const src = textContent.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
}

/* ---------------- HEADER MAPPING ---------------- */
/* Accepts the obvious spellings a real supplier sheet is likely to use. */
const FIELD_ALIASES = {
  id:    ["id","product id","sku","code","product code"],
  name:  ["name","product","product name","title","description of goods","item"],
  brand: ["brand","manufacturer","supplier","make"],
  cat:   ["cat","category","type","department","group"],
  list:  ["list","price","list price","rate","cost","unit price","wholesale price"],
  unit:  ["unit","pack","pack size","case","case size","packing","uom"],
  moq:   ["moq","min","min order","minimum","minimum order","min qty"],
  stock: ["stock","qty","quantity","stock qty","available","on hand","inventory"],
  emoji: ["emoji","icon","image"],
  flags: ["flags","tags","label","labels","badge"],
  desc:  ["desc","description","details","notes","about"],
};

function mapHeaders(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => {
    const key = String(h).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    if (!key) return;
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(key)) { map[field] = i; return; }
    }
  });
  return map;
}

/**
 * Reads a File and returns { rows, headers, map, unmapped }.
 * `rows` are objects keyed by product field, ready for bulkUpsertProducts.
 */
async function readProductSheet(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  let grid;
  if (ext === "xlsx" || ext === "xlsm") grid = await readXLSX(file);
  else if (ext === "csv" || ext === "txt") grid = parseCSV(await file.text());
  else if (ext === "xls") throw new Error("Legacy .xls isn't supported — re-save as .xlsx or .csv.");
  else throw new Error(`Unsupported file type ".${ext}". Upload .xlsx or .csv.`);

  if (!grid.length) throw new Error("That file appears to be empty.");

  const headers = grid[0].map(h => String(h).trim());
  const map = mapHeaders(headers);
  if (map.name === undefined && map.id === undefined)
    throw new Error("Couldn't find a 'name' (or 'id') column. The first row must be column headings.");

  const rows = grid.slice(1).map(r => {
    const obj = {};
    for (const [field, i] of Object.entries(map)) {
      const raw = r[i];
      if (raw === undefined || String(raw).trim() === "") continue;
      obj[field] = ["list","moq","stock","id"].includes(field)
        ? Number(String(raw).replace(/[^0-9.\-]/g, ""))
        : String(raw).trim();
    }
    return obj;
  }).filter(o => Object.keys(o).length);

  const unmapped = headers.filter((h, i) => h && !Object.values(map).includes(i));
  return { rows, headers, map, unmapped };
}
