import { createClient } from "npm:@supabase/supabase-js@2";
const BASE_CURRENCY = "AED";
const TRACKED_SOURCES = [
  { store: "steam", cc: "ae", catalog: null, currency: "AED", label: "Steam \xB7 AE" },
  { store: "steam", cc: "cn", catalog: null, currency: "CNY", label: "Steam \xB7 CN" },
  { store: "eshop", cc: "us", catalog: "NA", currency: "USD", label: "eShop \xB7 US" },
  { store: "eshop", cc: "co", catalog: "NA", currency: "COP", label: "eShop \xB7 CO" },
  { store: "eshop", cc: "cl", catalog: "NA", currency: "CLP", label: "eShop \xB7 CL" },
  { store: "eshop", cc: "pe", catalog: "NA", currency: "PEN", label: "eShop \xB7 PE" },
  { store: "eshop", cc: "za", catalog: "EU", currency: "ZAR", label: "eShop \xB7 ZA" },
  { store: "eshop", cc: "au", catalog: "EU", currency: "AUD", label: "eShop \xB7 AU" },
  { store: "eshop", cc: "nz", catalog: "EU", currency: "NZD", label: "eShop \xB7 NZ" },
  { store: "eshop", cc: "jp", catalog: "JP", currency: "JPY", label: "eShop \xB7 JP" },
  { store: "eshop", cc: "hk", catalog: "HK", currency: "HKD", label: "eShop \xB7 HK" }
];
const STEAM_REGIONS = TRACKED_SOURCES.filter((s) => s.store === "steam");
const ESHOP_REGIONS = TRACKED_SOURCES.filter((s) => s.store === "eshop");
const ACTIVE_CATALOGS = [
  ...new Set(ESHOP_REGIONS.map((s) => s.catalog).filter((c) => c !== null))
];
const toCents = (amount) => Math.round(amount * 100);
const DEFAULT_HEADERS = {
  "User-Agent": "game-price-compare/1.0 (personal wishlist tool)",
  Accept: "application/json, text/plain, */*"
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
async function fetchWithTimeout(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15e3);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      method: opts.method ?? "GET",
      body: opts.body,
      headers: { ...DEFAULT_HEADERS, ...opts.headers ?? {} }
    });
  } finally {
    clearTimeout(t);
  }
}
async function getJson(url, opts = {}) {
  const retries = opts.retries ?? 2;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, opts);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
const cleanNsuid = (id) => (id.match(/^\d+/)?.[0] ?? "").trim();
function gameCode4(raw) {
  if (!raw) return void 0;
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const code5 = s.length >= 8 ? s.slice(-5) : s.length === 5 ? s : null;
  return code5 ? code5.slice(0, 4) : void 0;
}
const CONFIDENCE = { AUTO: 0.85, REVIEW: 0.62 };
function normalizeTitle(raw) {
  let s = raw.replace(/[™®©]/g, " ");
  s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.toLowerCase();
  s = s.replace(/&/g, " and ");
  s = s.replace(/[^a-z0-9 ]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(
    /\b(deluxe|standard|ultimate|gold|complete|definitive|goty|game of the year|remastered|remaster|hd|edition|bundle|pack|digital|nintendo switch 2 edition|switch 2 edition|nintendo switch 2|for nintendo switch|nintendo switch)\b/g,
    " "
  );
  s = s.replace(/\s+/g, " ").trim();
  s = s.split(" ").map((t) => {
    const n = romanToInt(t);
    return n != null ? String(n) : t;
  }).join(" ");
  return s;
}
const ROMAN_VALUES = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1e3 };
function intToRoman(n) {
  if (n <= 0 || n > 3999) return "";
  const table = [
    [1e3, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"]
  ];
  let out = "";
  for (const [val, sym] of table) while (n >= val) out += sym, n -= val;
  return out;
}
function romanToInt(token) {
  if (!/^[ivxlcdm]{1,15}$/.test(token)) return null;
  let total = 0;
  let prev = 0;
  for (let i = token.length - 1; i >= 0; i--) {
    const v = ROMAN_VALUES[token[i]];
    if (v < prev) total -= v;
    else {
      total += v;
      prev = v;
    }
  }
  return intToRoman(total) === token ? total : null;
}
function versionSignature(norm) {
  return norm.split(" ").filter((t) => /^\d+$/.test(t)).map(Number).sort((a, b) => a - b).join(",");
}
function bigrams(s) {
  const m = /* @__PURE__ */ new Map();
  const compact = s.replace(/ /g, "");
  for (let i = 0; i < compact.length - 1; i++) {
    const bg = compact.slice(i, i + 2);
    m.set(bg, (m.get(bg) ?? 0) + 1);
  }
  return m;
}
function diceCoefficient(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  let totalA = 0;
  for (const n of A.values()) totalA += n;
  let totalB = 0;
  for (const n of B.values()) totalB += n;
  for (const [bg, countA] of A) {
    const countB = B.get(bg);
    if (countB) overlap += Math.min(countA, countB);
  }
  return 2 * overlap / (totalA + totalB);
}
function titleSimilarity(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (versionSignature(na) !== versionSignature(nb)) return 0;
  const dice = diceCoefficient(na, nb);
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = (/* @__PURE__ */ new Set([...ta, ...tb])).size;
  const jaccard = union ? inter / union : 0;
  const queryInCandidate = inter === ta.size && tb.size >= ta.size;
  const querySubstantial = ta.size >= 2 && na.replace(/ /g, "").length >= 6 && /[a-z]{4}/.test(na);
  const boost = queryInCandidate && querySubstantial ? 0.9 : 0;
  const score = Math.max(dice * 0.6 + jaccard * 0.4, boost);
  const missesSignificantWord = [...ta].some((t) => t.length >= 4 && !tb.has(t));
  if (missesSignificantWord && !queryInCandidate && dice < 0.85) return Math.min(score, 0.55);
  return score;
}
function bestMatch(query, candidates) {
  let best = null;
  for (const c of candidates) {
    const score = titleSimilarity(query, c.title);
    if (!best || score > best.score) best = { item: c, score };
  }
  if (!best || best.score < CONFIDENCE.REVIEW) return null;
  return {
    item: best.item,
    score: best.score,
    status: best.score >= CONFIDENCE.AUTO ? "confirmed" : "needs_review"
  };
}
async function searchSteam(term, cc = "us") {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=${cc}&l=en`;
  const data = await getJson(url);
  return (data.items ?? []).filter((i) => i.type === "app").map((i) => ({ appid: i.id, name: i.name, windows: i.platforms?.windows ?? false }));
}
async function getSteamPrice(appid, cc) {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${cc}&filters=price_overview`;
  const data = await getJson(url);
  const po = data[String(appid)]?.data?.price_overview;
  if (!data[String(appid)]?.success || !po) {
    return { currency: "", initialCents: 0, finalCents: 0, discountPercent: 0, available: false };
  }
  return { currency: po.currency, initialCents: po.initial, finalCents: po.final, discountPercent: po.discount_percent, available: true };
}
async function getSteamAppName(appid) {
  try {
    const data = await getJson(
      `https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic`
    );
    return data[String(appid)]?.data?.name ?? null;
  } catch {
    return null;
  }
}
function parseSteamProfile(input) {
  const trimmed = input.trim();
  if (/^\d{17}$/.test(trimmed)) return { steamid: trimmed };
  const prof = trimmed.match(/profiles\/(\d{17})/);
  if (prof) return { steamid: prof[1] };
  const vanity = trimmed.match(/\/id\/([^/?#]+)/);
  if (vanity) return { vanity: vanity[1] };
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) return { vanity: trimmed };
  return {};
}
async function getSteamWishlist(input) {
  const { steamid, vanity } = parseSteamProfile(input);
  if (steamid) {
    try {
      const data = await getJson(
        `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamid}`,
        { retries: 1 }
      );
      const items = data.response?.items ?? [];
      if (items.length) return items.map((i) => ({ appid: i.appid }));
    } catch {
    }
  }
  const base = steamid ? `https://store.steampowered.com/wishlist/profiles/${steamid}/wishlistdata/` : `https://store.steampowered.com/wishlist/id/${vanity}/wishlistdata/`;
  const out = [];
  for (let page = 0; page < 30; page++) {
    const data = await getJson(`${base}?p=${page}`, { retries: 1 }).catch(() => ({}));
    const keys = Object.keys(data).filter((k) => /^\d+$/.test(k));
    if (keys.length === 0) break;
    for (const k of keys) out.push({ appid: Number(k), name: data[k]?.name });
  }
  return out;
}
async function searchNA(query) {
  const data = await getJson(
    "https://u3b6gr4ua3-dsn.algolia.net/1/indexes/store_game_en_us/query",
    {
      method: "POST",
      headers: {
        "X-Algolia-API-Key": "a29c6927638bfd8cee23993e51e721c9",
        "X-Algolia-Application-Id": "U3B6GR4UA3",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, hitsPerPage: 24 })
    }
  );
  const out = [];
  for (const h of data.hits ?? []) {
    const nsuid = h.nsuid ?? h.nsuids?.[0];
    if (nsuid && h.title) out.push({ title: h.title, nsuid: cleanNsuid(String(nsuid)) });
  }
  return out;
}
async function searchEU(query) {
  const url = `https://search.nintendo-europe.com/en/select?q=${encodeURIComponent(query)}&fq=type:GAME&rows=24&wt=json&fl=title,nsuid_txt,product_code_txt`;
  const data = await getJson(url);
  const out = [];
  for (const d of data.response?.docs ?? []) {
    const nsuid = d.nsuid_txt?.[0];
    if (nsuid && d.title) out.push({ title: d.title, nsuid, code: gameCode4(d.product_code_txt?.[0]) });
  }
  return out;
}
async function searchJP(query) {
  const url = `https://search.nintendo.jp/nintendo_soft/search.json?q=${encodeURIComponent(query)}&limit=24&opt_sshow=1`;
  const data = await getJson(url);
  const out = [];
  for (const it of data.result?.items ?? []) {
    const nsuid = it.id ? cleanNsuid(it.id) : "";
    if (nsuid && it.title) out.push({ title: it.title, nsuid, code: gameCode4(it.icode) });
  }
  return out;
}
async function searchHK(_query) {
  return [];
}
const LIVE_SEARCH = {
  NA: searchNA,
  EU: searchEU,
  JP: searchJP,
  HK: searchHK
};
async function searchCatalogLive(catalog, query) {
  try {
    return await LIVE_SEARCH[catalog](query);
  } catch {
    return [];
  }
}
function titleMatchLink(catalog, candidates, title) {
  const m = bestMatch(title, candidates);
  if (!m) return { catalog, nsuid: null, matchedTitle: null, confidence: 0, status: "unavailable" };
  return {
    catalog,
    nsuid: m.item.nsuid,
    matchedTitle: m.item.title,
    confidence: Number(m.score.toFixed(3)),
    status: m.status,
    via: "title"
  };
}
async function resolveEshopLive(title, catalogs) {
  const candByCat = new Map(
    await Promise.all(catalogs.map(async (c) => [c, await searchCatalogLive(c, title)]))
  );
  const links = catalogs.map((c) => titleMatchLink(c, candByCat.get(c) ?? [], title));
  const anchors = /* @__PURE__ */ new Set();
  for (const cands of candByCat.values()) {
    for (const e of cands) {
      if (e.code && titleSimilarity(title, e.title) >= CONFIDENCE.AUTO) anchors.add(e.code);
    }
  }
  if (anchors.size) {
    for (const link of links) {
      if (link.status !== "unavailable") continue;
      const hit = (candByCat.get(link.catalog) ?? []).find((e) => e.code && anchors.has(e.code));
      if (hit) {
        link.nsuid = hit.nsuid;
        link.matchedTitle = hit.title;
        link.confidence = 0.8;
        link.status = "needs_review";
        link.via = "code";
      }
    }
  }
  return links;
}
async function getEshopPrices(nsuids, country) {
  const out = [];
  const clean = [...new Set(nsuids.map(cleanNsuid).filter(Boolean))];
  for (const group of chunk(clean, 50)) {
    const url = `https://api.ec.nintendo.com/v1/price?country=${country}&lang=en&ids=${group.join(",")}`;
    const data = await getJson(url);
    for (const p of data.prices ?? []) {
      const nsuid = String(p.title_id);
      const reg = p.regular_price;
      if (!reg) {
        out.push({ nsuid, currency: "", initialCents: 0, finalCents: 0, discountPercent: 0, salesStatus: p.sales_status ?? "not_found", available: false });
        continue;
      }
      const initialCents = toCents(parseFloat(reg.raw_value));
      const finalCents = p.discount_price ? toCents(parseFloat(p.discount_price.raw_value)) : initialCents;
      const discountPercent = initialCents > 0 ? Math.round((1 - finalCents / initialCents) * 100) : 0;
      out.push({
        nsuid,
        currency: reg.currency,
        initialCents,
        finalCents,
        discountPercent,
        salesStatus: p.sales_status,
        available: p.sales_status !== "not_found" && finalCents > 0
      });
    }
    await sleep(150);
  }
  return out;
}
let _sb = null;
function sb() {
  if (_sb) return _sb;
  _sb = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false }
  });
  return _sb;
}
async function removeGame(gameId) {
  const { error } = await sb().from("games").delete().eq("game_id", gameId);
  if (error) throw error;
}
async function createGame(title) {
  const { data, error } = await sb().from("games").insert({ title }).select("game_id").single();
  if (error) throw error;
  return data.game_id;
}
async function findGameByTitle(title) {
  const { data } = await sb().from("games").select("game_id").ilike("title", title).limit(1).maybeSingle();
  return data ?? null;
}
async function upsertLinks(links) {
  if (!links.length) return;
  const { error } = await sb().from("game_links").insert(links);
  if (error) throw error;
}
async function addToWishlist(gameId, source) {
  const { error } = await sb().from("wishlist").upsert({ game_id: gameId, source }, { onConflict: "game_id", ignoreDuplicates: true });
  if (error) throw error;
}
async function getLinks(gameId) {
  const { data, error } = await sb().from("game_links").select("*").eq("game_id", gameId);
  if (error) throw error;
  return data ?? [];
}
async function getWishlistIds() {
  const { data, error } = await sb().from("wishlist").select("game_id");
  if (error) throw error;
  return (data ?? []).map((r) => r.game_id);
}
async function savePrices(rows) {
  if (!rows.length) return;
  const { error } = await sb().from("prices").insert(rows);
  if (error) throw error;
}
async function saveFxRate(currency, rateToAed) {
  await sb().from("fx_rates").upsert({ currency, rate_to_aed: rateToAed, updated_at: (/* @__PURE__ */ new Date()).toISOString() }, { onConflict: "currency" });
}
async function searchCatalog(query, limit = 12) {
  const qnorm = normalizeTitle(query);
  if (!qnorm) return { candidates: [], confident: false };
  const { data, error } = await sb().rpc("cat_candidates", { q_norm: qnorm, lim: 400 });
  if (error) throw error;
  const rows = data ?? [];
  const byNorm = /* @__PURE__ */ new Map();
  for (const r of rows) {
    const score = titleSimilarity(query, r.name);
    if (score < CONFIDENCE.REVIEW) continue;
    const s = { ...r, score };
    let g = byNorm.get(r.name_norm);
    if (!g) {
      g = { best: s };
      byNorm.set(r.name_norm, g);
    }
    if (s.score > g.best.score) g.best = s;
    if (s.kind === "steam" && !g.steam) g.steam = s;
    if (s.kind === "eshop" && s.catalog === "NA" && !g.na) g.na = s;
  }
  const candidates = [];
  for (const g of byNorm.values()) {
    candidates.push({
      title: g.best.name,
      score: g.best.score,
      steamAppid: g.steam ? Number(g.steam.ref) : null,
      steamName: g.steam ? g.steam.name : null,
      naNsuid: g.na ? g.na.ref : null,
      naTitle: g.na ? g.na.name : null
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, limit);
  return { candidates: top, confident: top.length > 0 && top[0].score >= CONFIDENCE.AUTO };
}
async function resolveEshopFromCatalog(title, catalogs = ACTIVE_CATALOGS) {
  const qnorm = normalizeTitle(title);
  if (!qnorm) return null;
  const perCat = /* @__PURE__ */ new Map();
  for (const c of catalogs) {
    const { data: exact } = await sb().rpc("cat_eshop_exact", { q_norm: qnorm, cat: c });
    if (exact && exact[0]) {
      perCat.set(c, { nsuid: exact[0].nsuid, name: exact[0].name, titleId: exact[0].title_id, score: 1 });
      continue;
    }
    const { data: rows } = await sb().rpc("cat_eshop_in_catalog", { q_norm: qnorm, cat: c, lim: 150 });
    let best = null;
    for (const r of rows ?? []) {
      const score = titleSimilarity(title, r.name);
      if (!best || score > best.score) best = { nsuid: r.nsuid, name: r.name, titleId: r.title_id, score };
    }
    if (best) perCat.set(c, best);
  }
  const anchors = /* @__PURE__ */ new Set();
  for (const h of perCat.values()) if (h.titleId && h.score >= CONFIDENCE.AUTO) anchors.add(h.titleId);
  const links = [];
  for (const c of catalogs) {
    const h = perCat.get(c);
    if (h && h.score >= CONFIDENCE.REVIEW) {
      links.push({ catalog: c, nsuid: h.nsuid, matchedTitle: h.name, confidence: Number(h.score.toFixed(3)), status: h.score >= CONFIDENCE.AUTO ? "confirmed" : "needs_review", via: "title" });
      continue;
    }
    if (anchors.size) {
      const { data: a } = await sb().rpc("cat_eshop_by_titleid", { cat: c, ids: [...anchors] });
      if (a && a[0]) {
        links.push({ catalog: c, nsuid: a[0].nsuid, matchedTitle: a[0].name, confidence: 0.8, status: "needs_review", via: "code" });
        continue;
      }
    }
    links.push({ catalog: c, nsuid: null, matchedTitle: null, confidence: 0, status: "unavailable" });
  }
  return links.some((l) => l.status !== "unavailable") ? { links } : null;
}
async function appendSteamApp(appid, name) {
  const norm = normalizeTitle(name);
  if (!norm) return;
  await sb().from("cat_steam").upsert({ appid, name, name_norm: norm, source: "live" }, { onConflict: "appid", ignoreDuplicates: true });
}
async function appendEshopResolution(title, links) {
  const norm = normalizeTitle(title);
  if (!norm) return;
  const rows = links.filter((l) => l.nsuid && l.status !== "unavailable").map((l) => ({ catalog: l.catalog, nsuid: l.nsuid, title_id: null, name: title, name_norm: norm, source: "live" }));
  if (rows.length) await sb().from("cat_eshop").upsert(rows, { onConflict: "catalog,nsuid", ignoreDuplicates: true });
}
function catalogToCandidate(c) {
  return {
    title: c.title,
    steamAppid: c.steamAppid,
    steamName: c.steamName,
    windows: c.steamAppid != null,
    switchNsuid: c.naNsuid,
    switchTitle: c.naTitle,
    switchConfidence: c.naNsuid ? Number(c.score.toFixed(3)) : 0,
    switchStatus: c.naNsuid ? c.score >= CONFIDENCE.AUTO ? "confirmed" : "needs_review" : "unavailable",
    relevance: c.score
  };
}
async function searchUniversal(query) {
  const local = await searchCatalog(query, 12);
  const top = local.candidates[0];
  if (local.confident && top && top.steamAppid != null) {
    return local.candidates.map(catalogToCandidate);
  }
  return liveSearchUniversal(query);
}
async function liveSearchUniversal(query) {
  const [steamItems, naItems] = await Promise.all([
    searchSteam(query, "us").catch(() => []),
    searchCatalogLive("NA", query)
  ]);
  for (const s of steamItems) await appendSteamApp(s.appid, s.name).catch(() => {
  });
  const candidates = [];
  const usedNa = /* @__PURE__ */ new Set();
  for (const s of steamItems.slice(0, 10)) {
    const m = bestMatch(s.name, naItems);
    if (m) usedNa.add(m.item.nsuid);
    candidates.push({
      title: s.name,
      steamAppid: s.appid,
      steamName: s.name,
      windows: s.windows,
      switchNsuid: m?.item.nsuid ?? null,
      switchTitle: m?.item.title ?? null,
      switchConfidence: m ? Number(m.score.toFixed(3)) : 0,
      switchStatus: m?.status ?? "unavailable",
      relevance: titleSimilarity(query, s.name)
    });
  }
  for (const na of naItems) {
    if (usedNa.has(na.nsuid)) continue;
    const rel = titleSimilarity(query, na.title);
    if (rel < CONFIDENCE.REVIEW) continue;
    candidates.push({
      title: na.title,
      steamAppid: null,
      steamName: null,
      windows: false,
      switchNsuid: na.nsuid,
      switchTitle: na.title,
      switchConfidence: Number(rel.toFixed(3)),
      switchStatus: rel >= CONFIDENCE.AUTO ? "confirmed" : "needs_review",
      relevance: rel
    });
  }
  const deduped = [];
  for (const c of candidates) {
    if (deduped.some((d) => titleSimilarity(d.title, c.title) >= CONFIDENCE.AUTO)) continue;
    deduped.push(c);
  }
  deduped.sort((a, b) => b.relevance - a.relevance);
  return deduped.slice(0, 12);
}
async function addGameFromSearch(candidate, source = "search") {
  const gameId = await createGame(candidate.title);
  const links = [];
  links.push(candidate.steamAppid ? { game_id: gameId, store: "steam", catalog: null, external_id: String(candidate.steamAppid), matched_title: candidate.title, status: "confirmed", confidence: 1 } : { game_id: gameId, store: "steam", catalog: null, external_id: null, matched_title: null, status: "unavailable", confidence: null });
  const fromCatalog = await resolveEshopFromCatalog(candidate.title);
  let resolved;
  if (fromCatalog) {
    resolved = fromCatalog.links;
  } else {
    resolved = await resolveEshopLive(candidate.title, ACTIVE_CATALOGS);
    await appendEshopResolution(candidate.title, resolved).catch(() => {
    });
  }
  for (const r of resolved) {
    links.push({ game_id: gameId, store: "eshop", catalog: r.catalog, external_id: r.nsuid, matched_title: r.matchedTitle, status: r.status, confidence: r.confidence });
  }
  await upsertLinks(links);
  if (candidate.steamAppid) await appendSteamApp(candidate.steamAppid, candidate.title).catch(() => {
  });
  await addToWishlist(gameId, source);
  return { gameId, title: candidate.title, links: resolved };
}
async function refreshGamePrices(gameId) {
  const links = await getLinks(gameId);
  const steamLink = links.find((l) => l.store === "steam" && l.external_id);
  const eshopByCatalog = /* @__PURE__ */ new Map();
  for (const l of links) {
    if (l.store === "eshop" && l.catalog && l.external_id && l.status !== "unavailable") {
      eshopByCatalog.set(l.catalog, l.external_id);
    }
  }
  const rows = [];
  const tasks = [];
  if (steamLink?.external_id) {
    const appid = Number(steamLink.external_id);
    for (const reg of STEAM_REGIONS) {
      tasks.push((async () => {
        try {
          const p = await getSteamPrice(appid, reg.cc);
          rows.push({
            game_id: gameId,
            store: "steam",
            region_cc: reg.cc,
            currency: p.available ? p.currency : reg.currency,
            initial_cents: p.available ? p.initialCents : null,
            final_cents: p.available ? p.finalCents : null,
            discount_percent: p.discountPercent,
            sales_status: p.available ? "onsale" : "unavailable"
          });
        } catch {
        }
      })());
    }
  }
  for (const reg of ESHOP_REGIONS) {
    const nsuid = reg.catalog ? eshopByCatalog.get(reg.catalog) : void 0;
    if (!nsuid) continue;
    tasks.push((async () => {
      try {
        const [price] = await getEshopPrices([nsuid], reg.cc.toUpperCase());
        if (!price) return;
        rows.push({
          game_id: gameId,
          store: "eshop",
          region_cc: reg.cc,
          currency: price.available ? price.currency : reg.currency,
          initial_cents: price.available ? price.initialCents : null,
          final_cents: price.available ? price.finalCents : null,
          discount_percent: price.discountPercent,
          sales_status: price.salesStatus
        });
      } catch {
      }
    })());
  }
  await Promise.all(tasks);
  await savePrices(rows);
}
async function refreshFx() {
  const wanted = [...new Set(TRACKED_SOURCES.map((s) => s.currency))].filter((c) => c !== BASE_CURRENCY);
  const inverted = {};
  try {
    const data = await getJson("https://open.er-api.com/v6/latest/AED");
    if (data.result === "success" && data.rates) {
      for (const cur of wanted) {
        const perAed = data.rates[cur];
        if (perAed && perAed > 0) inverted[cur] = 1 / perAed;
      }
    }
  } catch {
  }
  if (inverted.USD == null) inverted.USD = 3.6725;
  for (const [cur, rate] of Object.entries(inverted)) await saveFxRate(cur, rate);
  await saveFxRate(BASE_CURRENCY, 1);
  return inverted;
}
const JSON_HEADERS = { "content-type": "application/json" };
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "*"
};
const _json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...JSON_HEADERS, ...cors } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, "").split("/").pop();
  try {
    if (route === "search") {
      const q = url.searchParams.get("q")?.trim() ?? "";
      if (!q) return _json({ candidates: [] });
      return _json({ candidates: await searchUniversal(q) });
    }
    if (route === "add") {
      const body = await req.json().catch(() => ({}));
      const title = String(body?.title ?? "").trim();
      if (!title) return _json({ error: "title required" }, 400);
      if (await findGameByTitle(title)) return _json({ error: "already in wishlist" }, 409);
      const added = await addGameFromSearch({ title, steamAppid: body?.steamAppid ?? null });
      await refreshGamePrices(added.gameId);
      return _json({ gameId: added.gameId, title: added.title, links: added.links });
    }
    if (route === "refresh") {
      const body = await req.json().catch(() => ({}));
      await refreshFx();
      const ids = body?.id ? [Number(body.id)] : await getWishlistIds();
      for (const id of ids) await refreshGamePrices(id);
      return _json({ refreshed: ids.length });
    }
    if (route === "import") {
      const body = await req.json().catch(() => ({}));
      const input = String(body?.input ?? "").trim();
      if (!input) return _json({ error: "input required" }, 400);
      const items = await getSteamWishlist(input);
      let added = 0, skipped = 0;
      for (const item of items) {
        const name = item.name ?? await getSteamAppName(item.appid) ?? `App ${item.appid}`;
        if (await findGameByTitle(name)) {
          skipped++;
          continue;
        }
        const r = await addGameFromSearch({ title: name, steamAppid: item.appid }, "steam_import");
        await refreshGamePrices(r.gameId);
        added++;
      }
      return _json({ found: items.length, added, skipped });
    }
    if (route === "remove") {
      const body = await req.json().catch(() => ({}));
      const id = Number(body?.id);
      if (!id) return _json({ error: "id required" }, 400);
      await removeGame(id);
      return _json({ ok: true });
    }
    return _json({ error: `unknown route: ${route}` }, 404);
  } catch (e) {
    return _json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
export {
  ACTIVE_CATALOGS,
  BASE_CURRENCY,
  CONFIDENCE,
  ESHOP_REGIONS,
  JSON_HEADERS,
  STEAM_REGIONS,
  TRACKED_SOURCES,
  addGameFromSearch,
  addToWishlist,
  appendEshopResolution,
  appendSteamApp,
  bestMatch,
  chunk,
  createGame,
  findGameByTitle,
  getEshopPrices,
  getJson,
  getLinks,
  getSteamAppName,
  getSteamPrice,
  getSteamWishlist,
  getWishlistIds,
  normalizeTitle,
  refreshFx,
  refreshGamePrices,
  removeGame,
  resolveEshopFromCatalog,
  resolveEshopLive,
  saveFxRate,
  savePrices,
  sb,
  searchCatalog,
  searchCatalogLive,
  searchSteam,
  searchUniversal,
  sleep,
  titleSimilarity,
  toCents,
  upsertLinks
};
