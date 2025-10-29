import dotenv from 'dotenv';
dotenv.config(); // Load environment variables from .env file

import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import sqlite3 from "sqlite3";
import QRCode from "qrcode";
import { webcrypto } from "crypto";
import cloudinary from "cloudinary";

sqlite3.verbose();
const cloudinaryV2 = cloudinary.v2;

const app = express();
app.use(express.json());

// Allow cross-origin requests (helps mobile/web clients and external test tools)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Configure Cloudinary
cloudinaryV2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'drppscucj',
  api_key: process.env.CLOUDINARY_API_KEY || 'your_api_key_here',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'your_api_secret_here'
});

// ✅ Unified Content Security Policy (enables Chart.js, XLSX, inline scripts for now)
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", [
    "default-src 'self' https: data: blob:",
    "script-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'",
    "script-src-elem 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'",
    "script-src-attr 'self' 'unsafe-inline'",
    "style-src 'self' https: 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https: data: https://fonts.gstatic.com",
    // allow Cloudinary image CDN
    "img-src 'self' https: data: blob: https://res.cloudinary.com",
    // allow connections to Cloudinary API if front-end uses it directly
    "connect-src 'self' https: data: blob: https://api.cloudinary.com https://res.cloudinary.com",
    "media-src 'self' https: data: blob:",
    "worker-src 'self' blob:",
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; "));
  next();
});


// ✅ Content Security Policy: allow our CDNs + inline for now
// ✅ Content Security Policy: permite 'unsafe-eval' solo para librerías (Chart.js, QRCode)
// 🔎 Simple request logger
app.use((req, res, next) => {
  console.log(`➡️  ${req.method} ${req.url}`);
  next();
});

// =================== DATABASE ===================
// ES module compatibility: provide __filename and __dirname using fileURLToPath
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, "venues.db");
console.log("📁 SQLite file:", DB_PATH);
const db = new sqlite3.Database(DB_PATH, (err) => {

// ---------- Schema guards & migrations (runs before routes) ----------
function ensurePromoImageColumn(cb){
  try{
    db.all(`PRAGMA table_info(promotions)`, (err, cols)=>{
      if (err){ console.error('[schema] PRAGMA error:', err.message); return cb && cb(err); }
      const hasImage = Array.isArray(cols) && cols.some(c => c.name === 'image');
      if (hasImage) return cb && cb(null);
      db.run(`ALTER TABLE promotions ADD COLUMN image TEXT`, (e)=>{
        if (e && !/duplicate|exists/i.test(e.message)) {
          console.error('[schema] ALTER promotions ADD image failed:', e.message);
          return cb && cb(e);
        }
        console.log('✅ promotions.image column ensured');
        cb && cb(null);
      });
    });
  }catch(e){
    console.error('[schema] ensurePromoImageColumn failed:', e);
    cb && cb(e);
  }
}

// Run schema guard at boot before wiring routes
let __schemaReady = false;
function ensureSchemaAtBoot(next){
  ensurePromoImageColumn((err)=>{
    __schemaReady = !err;
    if (!err) console.log('✅ Schema ready');
    else console.warn('⚠️ Schema not fully ready, routes will auto-retry migrate.');
    next && next();
  });
}
  if (err) console.error("❌ DB open error:", err);
});
db.serialize();
db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;", (err) => {
  if (err) console.warn("⚠️  PRAGMA set failed:", err.message);
});

// Helpers for busy retry
function runWithRetry(sql, params = [], label = "run", maxRetries = 5, delay = 50) {
  return new Promise((resolve, reject) => {
    const attempt = (n, d) => {
      db.run(sql, params, function (err) {
        if (err && /SQLITE_BUSY/i.test(err.message) && n < maxRetries) {
          return setTimeout(() => attempt(n + 1, d * 2), d);
        }
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      });
    };
    attempt(0, delay);
  });
}
function allWithRetry(sql, params = [], label = "all", maxRetries = 5, delay = 50) {
  return new Promise((resolve, reject) => {
    const attempt = (n, d) => {
      db.all(sql, params, (err, rows) => {
        if (err && /SQLITE_BUSY/i.test(err.message) && n < maxRetries) {
          return setTimeout(() => attempt(n + 1, d * 2), d);
        }
        if (err) return reject(err);
        resolve(rows);
      });
    };
    attempt(0, delay);
  });
}
function getWithRetry(sql, params = [], label = "get", maxRetries = 5, delay = 50) {
  return new Promise((resolve, reject) => {
    const attempt = (n, d) => {
      db.get(sql, params, (err, row) => {
        if (err && /SQLITE_BUSY/i.test(err.message) && n < maxRetries) {
          return setTimeout(() => attempt(n + 1, d * 2), d);
        }
        if (err) return reject(err);
        resolve(row);
      });
    };
    attempt(0, delay);
  });
}

// =================== UTIL: ISO Week ===================
function getISOWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // 1..7, Mon=1
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

// Helpers for “one per day” (UTC)
function startOfTodayUTC() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
  return Math.floor(d.getTime() / 1000); // seconds
}
const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

// Ensure promotion_claims has columns (no try/catch syntax quirks)
async function ensureClaimColumns(){
  // read existing columns
  const cols = await allWithRetry(`PRAGMA table_info(promotion_claims)`);
  const names = Array.isArray(cols) ? cols.map(c => c.name) : [];
  async function addIfMissing(col, sql){
    if (!names.includes(col)) { await runWithRetry(sql); }
  }
  await addIfMissing('code',        `ALTER TABLE promotion_claims ADD COLUMN code TEXT`);
  await addIfMissing('qr',          `ALTER TABLE promotion_claims ADD COLUMN qr TEXT`);
  await addIfMissing('redeemed',    `ALTER TABLE promotion_claims ADD COLUMN redeemed INTEGER DEFAULT 0`);
  await addIfMissing('redeemed_at', `ALTER TABLE promotion_claims ADD COLUMN redeemed_at INTEGER`);
}

// =================== SCHEMA ===================
(async () => {
  try {
    await runWithRetry(`CREATE TABLE IF NOT EXISTS venues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      category TEXT,
      price TEXT,
      zone TEXT,
      expect TEXT,
      image TEXT,
      isPick INTEGER,
      lat REAL,
      lng REAL,
      clicks INTEGER DEFAULT 0
    )`);

    await runWithRetry(`CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      type TEXT,
      ts INTEGER,
      userId TEXT,
      venue TEXT,
      zone TEXT,
      sessionId TEXT
    )`);

    await runWithRetry(`CREATE TABLE IF NOT EXISTS admin_logins (
      id TEXT PRIMARY KEY,
      ts INTEGER,
      ip TEXT,
      device TEXT,
      userAgent TEXT
    )`);

    await runWithRetry(`CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venueId INTEGER,
      userId TEXT,
      week INTEGER,
      ts INTEGER
    )`);

    // 🔒 Enforce "one vote per user per week"
    await runWithRetry(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_votes_user_week
       ON votes(userId, week)`
    );

    // 🏆 Weekly leaderboard history
    await runWithRetry(`
      CREATE TABLE IF NOT EXISTS leaderboard_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL,
        week INTEGER NOT NULL,
        name TEXT NOT NULL,
        votes INTEGER DEFAULT 0,
        recorded_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);

    // 🎟️ Promotions master (per venue)
    await runWithRetry(`
      CREATE TABLE IF NOT EXISTS promotions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venueId INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        image TEXT,
        code TEXT UNIQUE,
        qr TEXT,
        claims INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);

    // 📥 Promotion claims (one per user per day per promo)
    await runWithRetry(`
      CREATE TABLE IF NOT EXISTS promotion_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        promoId INTEGER NOT NULL,
        userId TEXT NOT NULL,
        venueId INTEGER NOT NULL,
        claimed_at INTEGER DEFAULT (strftime('%s','now'))
      )
    `);

    await runWithRetry(`CREATE INDEX IF NOT EXISTS ix_promo_claims_user ON promotion_claims(userId)`);
    await runWithRetry(`CREATE INDEX IF NOT EXISTS ix_promo_claims_promo ON promotion_claims(promoId)`);
  } catch (err) {
    console.error("❌ DB schema init failed:", err.message);
  }
})();

// =================== VENUES API ===================

// Get all venues sorted by clicks
app.get("/api/venues", async (req, res) => {
  try {
    const rows = await allWithRetry("SELECT * FROM venues ORDER BY clicks DESC, name ASC");
    // Auto-migrate local Media images to Cloudinary on-the-fly so front-end sees CDN URLs
    for (let i = 0; i < rows.length; i++){
      try{ rows[i] = await ensureVenueImageUrl(rows[i]); }catch(e){ /* non-fatal */ }
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add venue (validated)
app.post("/api/venues", async (req, res) => {
  const { name, category, price, zone, expect, image, isPick, lat, lng } = req.body || {};
  if (!name || !name.trim()) {
    console.warn("❌ Skipped null/blank venue insert");
    return res.status(400).json({ error: "Venue name is required" });
  }
  try {
    const result = await runWithRetry(
      `INSERT INTO venues (name, category, price, zone, expect, image, isPick, lat, lng, clicks)
       VALUES (?,?,?,?,?,?,?,?,?,0)`,
      [name.trim(), category, price, zone, expect, image, isPick ? 1 : 0, lat, lng],
      "insert venue"
    );
    res.json({ id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update venue (validated)
app.put("/api/venues/:id", async (req, res) => {
  const { id } = req.params;
  const { name, category, price, zone, expect, image, isPick, lat, lng, clicks } = req.body || {};
  if (!id || !name || !name.trim()) {
    console.warn("❌ Skipped invalid update:", id);
    return res.status(400).json({ error: "Invalid or missing venue name/id" });
  }
  try {
    await runWithRetry(
      `UPDATE venues
         SET name=?,
             category=?,
             price=?,
             zone=?,
             expect=?,
             image=?,
             isPick=?,
             lat=?,
             lng=?,
             clicks = COALESCE(?, clicks)
       WHERE id=?`,
      [
        name?.trim?.() || "",
        category,
        price,
        zone,
        expect,
        image,
        isPick ? 1 : 0,
        lat,
        lng,
        Number.isFinite(clicks) ? clicks : null,
        id
      ],
      "update venue"
    );

    const row = await getWithRetry("SELECT * FROM venues WHERE id=?", [id]);
    res.json(row || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete venue
app.delete("/api/venues/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await runWithRetry("DELETE FROM venues WHERE id=?", [id]);
    res.json({ deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all venues
app.delete("/api/venues", async (req, res) => {
  try {
    const result = await runWithRetry("DELETE FROM venues");
    res.json({ deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =================== VOTES API ===================

// Cast a vote (validated, one per user/week). Returns new total.
app.post("/api/votes", async (req, res) => {
  const { venueId, userId, week } = req.body || {};
  const ts = Date.now();

  if (!venueId || venueId === "null") {
    return res.status(400).json({ error: "Invalid venueId" });
  }
  const venue = await getWithRetry("SELECT id FROM venues WHERE id=?", [venueId]);
  if (!venue) {
    console.warn("❌ Vote rejected — invalid venueId:", venueId);
    return res.status(400).json({ error: "Venue not found" });
  }

  const wk = Number.isFinite(week) ? week : getISOWeek().week;

  try {
    await runWithRetry(
      `INSERT INTO votes (venueId, userId, week, ts) VALUES (?, ?, ?, ?)`,
      [venueId, userId || "anon", wk, ts],
      "insert vote"
    );
    saveWeeklyLeaderboardSnapshot();
  } catch (err) {
    // Unique index violation -> already voted this week
    if (/SQLITE_CONSTRAINT/i.test(err.message)) {
      return res.status(409).json({ error: "User already voted this week" });
    }
    return res.status(500).json({ error: err.message });
  }

  try {
    const total = await getWithRetry(
      `SELECT COUNT(*) AS c FROM votes WHERE venueId=? AND week=?`,
      [venueId, wk]
    );
    res.json({ inserted: true, total: total?.c || 0, week: wk });
  } catch (err) {
    res.status(200).json({ inserted: true });
  }
});

// Reset all votes
app.delete("/api/votes", async (req, res) => {
  try {
    const result = await runWithRetry("DELETE FROM votes");
    res.json({ deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =================== SAVE WEEKLY LEADERBOARD SNAPSHOT ===================
async function saveWeeklyLeaderboardSnapshot() {
  try {
    const { year, week } = getISOWeek();
    const rows = await allWithRetry(`
      SELECT v.name, COUNT(vt.id) AS votes
      FROM votes vt
      JOIN venues v ON v.id = vt.venueId
      WHERE vt.week = ?
      GROUP BY vt.venueId
      ORDER BY votes DESC
    `, [week]);

    if (!rows.length) {
      console.log(`ℹ️ No votes to snapshot for Week ${week}`);
      return;
    }

    const insertSQL = `
      INSERT INTO leaderboard_history (year, week, name, votes)
      VALUES (?, ?, ?, ?)
    `;
    for (const r of rows) {
      await runWithRetry(insertSQL, [year, week, r.name, r.votes]);
    }

    console.log(`✅ Leaderboard snapshot saved for Year ${year} Week ${week}`);
  } catch (err) {
    console.error("❌ Failed to save leaderboard snapshot:", err.message);
  }
}

// Weekly leaderboard (current week if not provided)
app.get("/api/leaderboard", async (req, res) => {
  const wk = Number.isFinite(+req.query.week) ? +req.query.week : getISOWeek().week;
  try {
    const rows = await allWithRetry(
      `SELECT v.id, v.name, v.zone, COUNT(*) AS votes
         FROM votes vt
         JOIN venues v ON v.id = vt.venueId
        WHERE vt.week = ?
        GROUP BY vt.venueId
        ORDER BY votes DESC, v.name ASC
        LIMIT 50`,
      [wk]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Alias used by some front-ends
app.get("/api/votes-weekly", async (req, res) => {
  const { week } = req.query;
  const wk = Number.isFinite(+week) ? +week : getISOWeek().week;
  try {
    const rows = await allWithRetry(
      `SELECT v.name, COUNT(*) AS votes
         FROM votes vt
         JOIN venues v ON v.id = vt.venueId
        WHERE vt.week = ?
        GROUP BY vt.venueId
        ORDER BY votes DESC, v.name ASC
        LIMIT 10`,
      [wk]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =================== LEADERBOARD HISTORY & ALL-TIME ===================

// 🏆 All-time leaderboard (total votes ever)
app.get("/api/leaderboard-alltime", async (req, res) => {
  try {
    const rows = await allWithRetry(`
      SELECT v.name, v.zone, COUNT(vt.id) AS votes
      FROM votes vt
      JOIN venues v ON v.id = vt.venueId
      GROUP BY vt.venueId
      ORDER BY votes DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 📅 Historical leaderboard snapshots
app.get("/api/leaderboard-history", async (req, res) => {
  const { year, week } = req.query;
  let sql = "SELECT * FROM leaderboard_history";
  const params = [];

  if (year) {
    sql += " WHERE year = ?";
    params.push(year);
  }
  if (week) {
    sql += params.length ? " AND week = ?" : " WHERE week = ?";
    params.push(week);
  }

  sql += " ORDER BY year DESC, week DESC, votes DESC";

  try {
    const rows = await allWithRetry(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =================== DETAILED VOTES LOG ===================

app.get("/api/votes-detailed", async (req, res) => {
  try {
    const rows = await allWithRetry(`
      SELECT 
        v.name AS venue,
        vt.userId AS userId,
        vt.week AS week,
        strftime('%Y', datetime(vt.ts / 1000, 'unixepoch')) AS year,
        vt.ts AS timestamp
      FROM votes vt
      JOIN venues v ON v.id = vt.venueId
      ORDER BY vt.week DESC, vt.ts DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("❌ Failed to load detailed votes:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =================== PROMOTIONS (QR + Claims) ===================

// 🔧 Helper: deactivate expired promos (older than 7 days)
async function deactivateExpiredPromotions() {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const cutoff = nowSec - SEVEN_DAYS_SEC;
    const res = await runWithRetry(
      `UPDATE promotions SET active=0 WHERE active=1 AND created_at < ?`,
      [cutoff]
    );
    if (res.changes) console.log(`🕒 Deactivated ${res.changes} expired promotions`);
  } catch (err) {
    console.warn("⚠️ Failed to auto-deactivate promotions:", err.message);
  }
}
// Run on boot & periodically (every 30 mins)
deactivateExpiredPromotions();
setInterval(deactivateExpiredPromotions, 30 * 60 * 1000);

// GET active promotions (active=1 AND within last 7 days)
app.get("/api/promotions", async (req, res) => {
  try {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - SEVEN_DAYS_SEC;
    const includeInactive = req.query && (req.query.includeInactive === '1' || req.query.includeInactive === 'true');
    // If includeInactive is truthy, return both active and inactive promos (admins use this)
    const sql = `
      SELECT 
        p.*,
        v.name as venueName,
        v.id as venueId,
        v.zone as venueZone,
        v.image as venueImage
      FROM promotions p
      INNER JOIN venues v ON v.id = p.venueId
      WHERE p.created_at >= ? ${includeInactive ? '' : 'AND p.active = 1'}
    `;
    const promos = await allWithRetry(sql, [sevenDaysAgo], includeInactive ? "get-promos-with-inactive" : "get-active-promos");
    // Auto-migrate any local images referenced by the promo or its venue
    for (let i = 0; i < promos.length; i++){
      try{ promos[i] = await ensurePromoImageUrl(promos[i]); }catch(e){}
      try{ if (promos[i] && promos[i].venueImage) promos[i].venueImage = (await ensureVenueImageUrl({ id: promos[i].venueId, image: promos[i].venueImage })).image; }catch(e){}
    }
    res.json(promos);
  } catch (err) {
    console.error("Error getting promotions:", err);
    res.status(500).json({ error: "Could not get promotions" });
  }
});

// POST /api/promotions — create (or replace) a promotion for a venue
// Body: { venueId, title, description }

// POST /api/promotions — create (or replace) a promotion for a venue
// Body: { venueId, title, description, image }

// POST /api/promotions — create (or replace) a promotion for a venue
// Body: { venueId, title, description, image }
app.post("/api/promotions", async (req, res) => {
  const { venueId, title, description, image } = req.body || {};
  if (!venueId || !title) return res.status(400).json({ error: "venueId and title required" });

  const doInsert = async () => {
    try {
      const venue = await getWithRetry(`SELECT id, name FROM venues WHERE id=?`, [venueId]);
      if (!venue) return res.status(404).json({ error: "Venue not found" });

      await runWithRetry(`UPDATE promotions SET active=0 WHERE active=1 AND venueId=?`, [venueId]);

      const code = makeShortCode(8);
      const deepLink = `${req.protocol}://${req.get("host")}/promo/${code}`;
      const qrImage = await QRCode.toDataURL(deepLink, { errorCorrectionLevel: "M", margin: 1, scale: 6 });

      const { lastID } = await runWithRetry(`
        INSERT INTO promotions (venueId, title, description, image, code, qr, claims, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, 1, strftime('%s','now'))
      `, [venueId, title, (description || ""), (image || ""), code, qrImage]);

      const row = await getWithRetry(`
        SELECT p.id, p.title, p.description, p.image, p.code, p.qr, p.claims, p.created_at,
               p.venueId AS venueId, v.name AS venueName, v.zone AS venueZone, v.image AS venueImage
        FROM promotions p
        JOIN venues v ON v.id = p.venueId
        WHERE p.id = ?
      `, [lastID]);

      return res.json(row);
    } catch (err) {
      const msg = (err && err.message) || String(err);
      if (/UNIQUE/i.test(msg)) {
        return res.status(409).json({ error: "Retry: short code collision" });
      }
      if (/no such column: image/i.test(msg)) {
        // Auto-migrate then retry once
        return ensurePromoImageColumn((e2)=>{
          if (e2) return res.status(500).json({ error: e2.message || 'migration failed' });
          doInsert().catch(e3 => res.status(500).json({ error: (e3 && e3.message) || String(e3) }));
        });
      }
      return res.status(500).json({ error: msg });
    }
  };

  if (!__schemaReady) {
    return ensurePromoImageColumn((e)=>{
      if (e) return res.status(500).json({ error: e.message || 'migration failed' });
      doInsert().catch(err => res.status(500).json({ error: (err && err.message) || String(err) }));
    });
  }
  return doInsert();
});


function makeShortCode(n = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  const buf = new Uint8Array(n);
  (globalThis.crypto || webcrypto).getRandomValues(buf);
  let s = "";
  for (let i = 0; i < n; i++) s += alphabet[buf[i] % alphabet.length];
  return s;
}

// Claim a promotion (one per user/day)
// Body: { promoId, userId }
app.post("/api/promotions/claim", async (req, res) => {
  const { promoId, userId } = req.body || {};
  if (!promoId || !userId) return res.status(400).json({ error: "promoId and userId required" });

  try {
    const promo = await getWithRetry(`SELECT * FROM promotions WHERE id=?`, [promoId]);
    if (!promo) return res.status(404).json({ error: "Promotion not found" });

    // Check active and not expired (7d)
    const nowSec = Math.floor(Date.now() / 1000);
    if (promo.active !== 1 || (nowSec - promo.created_at) > SEVEN_DAYS_SEC) {
      return res.status(410).json({ error: "Promotion expired or inactive" });
    }

    // Per-day limit
    const today = startOfTodayUTC();
    const dupe = await getWithRetry(`
      SELECT id FROM promotion_claims
      WHERE promoId=? AND userId=? AND claimed_at >= ?
      ORDER BY claimed_at DESC LIMIT 1
    `, [promoId, userId, today]);
    if (dupe) {
      return res.status(429).json({ error: "Already claimed today" });
    }

    // Record claim with unique code
    const uniqueCode = makeShortCode(8);
    const claimQR = await QRCode.toDataURL(uniqueCode, { errorCorrectionLevel: "M", margin: 1, scale: 6 });
    
    await runWithRetry(`
      INSERT INTO promotion_claims (promoId, userId, venueId, claimed_at, code, qr)
      VALUES (?, ?, ?, strftime('%s','now'), ?, ?)
    `, [promoId, userId, promo.venueId, uniqueCode, claimQR]);

    // Bump counter
    await runWithRetry(`UPDATE promotions SET claims = claims + 1 WHERE id=?`, [promoId]);

    res.json({ claimed: true, qr: claimQR, code: uniqueCode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verify a promotion code (for venue staff to scan)
app.get("/api/promotions/verify/:code", async (req, res) => {
  const { code } = req.params;
  if (!code) return res.status(400).json({ valid: false, reason: "Code required" });

  try {
    // Find the claim by code
    const claim = await getWithRetry(`
      SELECT pc.*, p.title, p.description, p.active, p.created_at as promo_created_at, v.name as venueName
      FROM promotion_claims pc
      JOIN promotions p ON p.id = pc.promoId
      JOIN venues v ON v.id = pc.venueId
      WHERE pc.code = ?
    `, [code]);

    if (!claim) {
      return res.json({ valid: false, reason: "Invalid code" });
    }

    // Check if already redeemed
    if (claim.redeemed === 1) {
      return res.json({ valid: false, reason: "Code already used" });
    }

    // Check if promotion is active and not expired (7 days)
    const nowSec = Math.floor(Date.now() / 1000);
    if (claim.active !== 1 || (nowSec - claim.promo_created_at) > SEVEN_DAYS_SEC) {
      return res.json({ valid: false, reason: "Promotion expired or inactive" });
    }

    // Mark as redeemed
    await runWithRetry(`
      UPDATE promotion_claims 
      SET redeemed = 1, redeemed_at = strftime('%s','now') 
      WHERE id = ?
    `, [claim.id]);

    res.json({ 
      valid: true, 
      reason: `${claim.title} at ${claim.venueName}`,
      promotion: {
        title: claim.title,
        description: claim.description,
        venueName: claim.venueName
      }
    });
  } catch (err) {
    console.error("Verification error:", err);
    res.status(500).json({ valid: false, reason: "Server error" });
  }
});

// Reset (delete) all promotion claims + zero counters
app.delete("/api/promotions/reset", async (req, res) => {
  try {
    await runWithRetry(`DELETE FROM promotion_claims`);
    const r = await runWithRetry(`UPDATE promotions SET claims = 0`);
    res.json({ reset: true, promotionsUpdated: r.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete/deactivate promotions for a venue
app.delete("/api/promotions/by-venue/:venueId", async (req, res) => {
  const { venueId } = req.params;
  if (!venueId) return res.status(400).json({ error: "venueId required" });
  
  try {
    console.log('➡️ DELETE /api/promotions/by-venue', { venueId, query: req.query });
    await runWithRetry(`UPDATE promotions SET active = 0 WHERE venueId = ?`, [venueId]);
    res.json({ deactivated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Toggle promotion active state (flip when no body supplied)
app.put("/api/promotions/toggle/:promoId", async (req, res) => {
  const { promoId } = req.params;
  const { active } = req.body || {};
  if (!promoId) return res.status(400).json({ error: "promoId required" });
  try {
    console.log('➡️ PUT /api/promotions/toggle', { promoId, body: req.body, query: req.query });
    if (typeof active === 'undefined') {
      // Flip current active state
      await runWithRetry(`UPDATE promotions SET active = CASE WHEN active=1 THEN 0 ELSE 1 END WHERE id = ?`, [promoId]);
    } else {
      await runWithRetry(`UPDATE promotions SET active = ? WHERE id = ?`, [active ? 1 : 0, promoId]);
    }
    // Return updated row
    const row = await getWithRetry(`SELECT id, venueId, title, description, image, active FROM promotions WHERE id = ?`, [promoId]);
    res.json({ updated: true, promo: row });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Promotions performance summary (for Analytics table)
app.get("/api/promotions/summary", async (req, res) => {
  try {
    const rows = await allWithRetry(`
      SELECT v.name AS venue, p.title AS promotion, p.claims
      FROM promotions p
      JOIN venues v ON v.id = p.venueId
      ORDER BY p.claims DESC, p.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =================== CLEANUP ===================
app.delete("/api/cleanup", async (req, res) => {
  try {
    const invalidVotes = await allWithRetry(
      `SELECT COUNT(*) AS c FROM votes 
       WHERE venueId IS NULL OR venueId NOT IN (SELECT id FROM venues)`
    );
    await runWithRetry(
      `DELETE FROM votes 
       WHERE venueId IS NULL OR venueId NOT IN (SELECT id FROM venues)`
    );

    const invalidVenues = await allWithRetry(
      `SELECT COUNT(*) AS c FROM venues 
       WHERE name IS NULL OR TRIM(name) = ''`
    );
    await runWithRetry(`DELETE FROM venues WHERE name IS NULL OR TRIM(name) = ''`);

    res.json({
      message: "✅ Cleanup complete",
      deletedVotes: invalidVotes[0]?.c || 0,
      deletedVenues: invalidVenues[0]?.c || 0
    });
  } catch (err) {
    console.error("❌ Cleanup failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =================== EVENTS API ===================
app.post("/api/events", async (req, res) => {
  const { id, type, ts, userId, venue, zone, sessionId } = req.body || {};
  try {
    await runWithRetry(
      `INSERT OR REPLACE INTO events (id, type, ts, userId, venue, zone, sessionId)
       VALUES (?,?,?,?,?,?,?)`,
      [id, type, ts, userId, venue, zone, sessionId]
    );
    res.json({ inserted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/events", async (req, res) => {
  try {
    const rows = await allWithRetry("SELECT * FROM events ORDER BY ts ASC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.delete("/api/events/reset", async (req, res) => {
  try {
    const result = await runWithRetry("DELETE FROM events");
    res.json({ deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =================== ADMIN LOGINS ===================
app.post("/api/admin-logins", async (req, res) => {
  const { id, ts, device, userAgent } = req.body || {};
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  try {
    await runWithRetry(
      `INSERT OR REPLACE INTO admin_logins (id, ts, ip, device, userAgent)
       VALUES (?,?,?,?,?)`,
      [id, ts, ip, device, userAgent]
    );
    res.json({ inserted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/api/admin-logins", async (req, res) => {
  try {
    const rows = await allWithRetry("SELECT * FROM admin_logins ORDER BY ts DESC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.delete("/api/admin-logins/reset", async (req, res) => {
  try {
    const result = await runWithRetry("DELETE FROM admin_logins");
    res.json({ deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =================== IMAGE UPLOAD (CLOUDINARY) ===================
// Use memory storage for multer since we'll upload to Cloudinary
const memoryStorage = multer.memoryStorage();
const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

// Helper: upload a data URI to Cloudinary returning a Promise
function uploadDataUriToCloudinary(dataUri, opts = {}){
  return new Promise((resolve, reject) => {
    cloudinaryV2.uploader.upload(dataUri, opts, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

// Helper: upload a buffer (creates data URI)
async function uploadBufferToCloudinary(buffer, mimetype = 'image/jpeg', origname = 'file', folder = 'clicks/venues', prefix = ''){
  const dataUri = `data:${mimetype};base64,${buffer.toString('base64')}`;
  const public_id = `${prefix || 'img'}_${Date.now()}_${origname.replace(/[^\\w.-]/g, '_')}`;
  const opts = { folder, resource_type: 'image', public_id };
  const result = await uploadDataUriToCloudinary(dataUri, opts);
  return result;
}

// Helper: upload a local file path (relative to project) to Cloudinary
async function uploadLocalPathToCloudinary(localRelPath, folder = 'clicks/venues', prefix = ''){
  try{
    const abs = path.join(__dirname, localRelPath);
    if (!fs.existsSync(abs)) throw new Error('Local file not found: ' + abs);
    const buf = fs.readFileSync(abs);
    return await uploadBufferToCloudinary(buf, 'image/jpeg', path.basename(abs), folder, prefix);
  }catch(e){ throw e; }
}

// Auto-migrate local Media images to Cloudinary for a venue row
async function ensureVenueImageUrl(row){
  try{
    if (!row || !row.image) return row;
    const img = String(row.image || '');
    if (/^https?:\/\//i.test(img)) return row; // already a URL
    // treat as local path if starts with Media/ or file exists
    const localCandidate = img;
    const abs = path.join(__dirname, localCandidate);
    if (fs.existsSync(abs)){
      const r = await uploadLocalPathToCloudinary(localCandidate, 'clicks/venues', `venue_${row.id}`);
      if (r && r.secure_url){
        await runWithRetry(`UPDATE venues SET image = ? WHERE id = ?`, [r.secure_url, row.id]);
        row.image = r.secure_url;
      }
    }
    return row;
  }catch(e){ console.warn('ensureVenueImageUrl failed:', e.message); return row; }
}

// Auto-migrate local Media images to Cloudinary for a promotion row
async function ensurePromoImageUrl(p){
  try{
    if (!p || !p.image) return p;
    const img = String(p.image || '');
    if (/^https?:\/\//i.test(img)) return p;
    const abs = path.join(__dirname, img);
    if (fs.existsSync(abs)){
      const r = await uploadLocalPathToCloudinary(img, 'clicks/promotions', `promo_${p.id}`);
      if (r && r.secure_url){
        await runWithRetry(`UPDATE promotions SET image = ? WHERE id = ?`, [r.secure_url, p.id]);
        p.image = r.secure_url;
      }
    }
    return p;
  }catch(e){ console.warn('ensurePromoImageUrl failed:', e.message); return p; }
}

// Unified upload endpoint. Accepts multipart/form-data (field 'file') or JSON payload { image: dataURI | base64, mimetype?, filename? }
// Accept any file field name so clients that still use 'promoImage' or 'venueImage' work.
app.post('/upload', upload.any(), async (req, res) => {
  try{
    const folderHint = (req.query.folder || req.body.folder || req.body.type || 'venues').toString().toLowerCase();
    const folder = folderHint.includes('promo') || folderHint.includes('promotion') ? 'clicks/promotions' : 'clicks/venues';

    // multipart file took priority
    // multer .any() populates req.files as an array
    const multipartFile = (req.file && req.file.buffer) ? req.file : (Array.isArray(req.files) && req.files[0]) ? req.files[0] : null;
    if (multipartFile && multipartFile.buffer){
      const result = await uploadBufferToCloudinary(multipartFile.buffer, multipartFile.mimetype, multipartFile.originalname || multipartFile.filename || 'upload', folder);
      return res.json({ url: result.secure_url, public_id: result.public_id, raw: result });
    }

    // JSON body with image
    const bodyImage = req.body && (req.body.image || req.body.data || req.body.dataURI || req.body.dataUrl);
    if (bodyImage){
      let data = String(bodyImage || '');
      // if plain base64 without data: prefix, build a data URI
      if (!/^data:/i.test(data)){
        const mimetype = req.body.mimetype || 'image/jpeg';
        data = `data:${mimetype};base64,${data}`;
      }
      const filename = req.body.filename || req.body.name || `upload_${Date.now()}.jpg`;
      const result = await uploadDataUriToCloudinary(data, { folder, resource_type: 'image', public_id: `upload_${Date.now()}_${filename.replace(/[^\\w.-]/g, '_')}` });
      return res.json({ url: result.secure_url, public_id: result.public_id, raw: result });
    }

    return res.status(400).json({ error: 'No file or image data provided' });
  }catch(err){
    console.error('Unified upload failed:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});
// =================== STATIC FILES ===================
app.use('/Media', express.static(path.join(__dirname, 'Media')));
app.use(express.static(__dirname));
app.get("/health", (req, res) => res.send("✅ Server is running"));


// ---------- Schema guards & migrations (top-level) ----------
function ensurePromoImageColumn(cb){
  try{
    db.all(`PRAGMA table_info(promotions)`, (err, cols)=>{
      if (err){ console.error('[schema] PRAGMA error:', err.message); return cb && cb(err); }
      const hasImage = Array.isArray(cols) && cols.some(c => c.name === 'image');
      if (hasImage) return cb && cb(null);
      db.run(`ALTER TABLE promotions ADD COLUMN image TEXT`, (e)=>{
        if (e && !/duplicate|exists/i.test(e.message)) {
          console.error('[schema] ALTER promotions ADD image failed:', e.message);
          return cb && cb(e);
        }
        console.log('✅ promotions.image column ensured');
        cb && cb(null);
      });
    });
  }catch(e){
    console.error('[schema] ensurePromoImageColumn failed:', e);
    cb && cb(e);
  }
}

let __schemaReady = false;
function ensureSchemaAtBoot(next){
  ensurePromoImageColumn((err)=>{
    __schemaReady = !err;
    if (!err) console.log('✅ Schema ready');
    else console.warn('⚠️ Schema not fully ready, routes will auto-retry migrate.');
    next && next();
  });
}

// =================== START SERVER ===================
const PORT = process.env.PORT || 3000;
ensureSchemaAtBoot(()=>{

// ✅ Claims Remaining Logic (1 per day)
app.get("/api/promotions", async (req, res) => {
  try {
    const promos = await allWithRetry("SELECT * FROM promotions WHERE active=1");
    const userId = req.query.userId || "anon";
    const todayStart = Math.floor(Date.now() / 1000) - (Date.now() % 86400);

    for (const p of promos) {
      const claim = await getWithRetry(
        `SELECT id FROM promotion_claims WHERE promoId=? AND userId=? AND claimed_at > ?`,
        [p.id, userId, todayStart]
      );
      p.claimsRemaining = claim ? 0 : 1;
    }

    res.json(promos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 http://localhost:${PORT}`);
  });
});


// Graceful shutdown
function shutdown() {
  console.log("\n🛑 Shutting down...");
  db.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Danger: delete ALL promotions and claims (password required)
app.delete("/api/promotions/all-reset", async (req, res) => {
  try {
    const pw = (req.body && req.body.pw) || "";
    if (pw !== "end it") return res.status(403).json({ error: "forbidden" });
    await runWithRetry(`DELETE FROM promotion_claims`);
    await runWithRetry(`DELETE FROM promotions`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== Google Places Importer =====
require('dotenv').config();
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const MEDIA_DIR = path.join(__dirname, "Media", "Venues");
fs.mkdirSync(MEDIA_DIR, { recursive: true });

function mapPriceLevelToDollar(price_level) {
  if (price_level == null) return "$";
  if (price_level <= 1) return "$";
  if (price_level === 2) return "$$";
  return "$$$";
}

function mapTypesToCategory(types = []) {
  const t = new Set(types);
  if (t.has("night_club")) return "Club";
  if (t.has("bar")) return "Bar";
  if (t.has("meal_takeaway") || t.has("restaurant")) return "Lounge";
  return "Bar";
}

async function downloadImageToMedia(url, filenameBase = "place") {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("Photo fetch " + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    const file = `${filenameBase}-${Date.now()}.jpg`;
    const abs = path.join(MEDIA_DIR, file);
    fs.writeFileSync(abs, buf);
    return `Media/Venues/${file}`;
  } catch (e) {
    console.warn("Photo download failed:", e.message);
    return "";
  }
}

// Import route
app.post("/api/google/import", async (req, res) => {
  const {
    query = "",
    lat,
    lng,
    radius = 1200,
    zone = "Other",
    categoryHint = "",
    maxResults = 15
  } = req.body || {};

  const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: "Missing GOOGLE_MAPS_API_KEY" });

  try {
    const base = "https://maps.googleapis.com/maps/api/place";
    const url = (lat && lng)
      ? `${base}/nearbysearch/json?location=${lat},${lng}&radius=${radius}&type=bar&key=${API_KEY}`
      : `${base}/textsearch/json?query=${encodeURIComponent(query || "bars san juan puerto rico")}&key=${API_KEY}`;

    const out = await fetch(url).then(r => r.json());
    if (!out || !Array.isArray(out.results)) {
      return res.status(502).json({ error: "Bad Places response", raw: out });
    }

    const picks = out.results.slice(0, maxResults);
    const imported = [];

    for (const p of picks) {
      try {
        const detUrl = `${base}/details/json?place_id=${p.place_id}&fields=name,geometry,price_level,types,photos,website,formatted_address&key=${API_KEY}`;
        const det = await fetch(detUrl).then(r => r.json());
        const d = det?.result || {};

        let imagePath = "";
        if (Array.isArray(d.photos) && d.photos[0]?.photo_reference) {
          const photoref = d.photos[0].photo_reference;
          const photoUrl = `${base}/photo?maxwidth=1200&photo_reference=${photoref}&key=${API_KEY}`;
          imagePath = await downloadImageToMedia(photoUrl, (d.name||"place").toLowerCase().replace(/\s+/g,"-"));
        }

        const name = d.name || p.name;
        const category = categoryHint || mapTypesToCategory(d.types || p.types || []);
        const price = mapPriceLevelToDollar(d.price_level);
        const expect = d.formatted_address || "Imported via Google Places";
        const isPick = 0;
        const coord = d.geometry?.location || p.geometry?.location || {};
        const vlat = coord.lat ?? null;
        const vlng = coord.lng ?? null;

        const existSql = `SELECT id FROM venues WHERE lower(name)=lower(?) AND lower(zone)=lower(?)`;
        const exists = await new Promise((resolve, reject)=>{
          db.get(existSql, [name, zone], (err, row)=> err?reject(err):resolve(row));
        });

        if (exists?.id) {
          await new Promise((resolve,reject)=>{
            db.run(
              `UPDATE venues SET category=?, price=?, expect=?, image=COALESCE(?, image), lat=?, lng=? WHERE id=?`,
              [category, price, expect, imagePath || null, vlat, vlng, exists.id],
              function(err){ err?reject(err):resolve(); }
            );
          });
          imported.push({ id: exists.id, name, updated: true });
        } else {
          const params = [name, category, price, zone, expect, imagePath || null, isPick, vlat, vlng, 0];
          await new Promise((resolve,reject)=>{
            db.run(
              `INSERT INTO venues (name, category, price, zone, expect, image, isPick, lat, lng, clicks)
               VALUES (?,?,?,?,?,?,?,?,?,?)`,
              params,
              function(err){ err?reject(err):resolve(imported.push({ id: this.lastID, name, created: true })); }
            );
          });
        }
      } catch (e) {
        console.warn("Import one failed:", e.message);
      }
    }

    res.json({ ok: true, count: imported.length, items: imported });
  } catch (err) {
    console.error("Import error:", err);
    res.status(500).json({ error: err.message });
  }
});

// =================== RESET LEADERBOARD API ===================
app.delete("/api/leaderboard", async (req, res) => {
  try {
    const result = await runWithRetry("DELETE FROM leaderboard_history");
    console.log(`🗑️ Leaderboard reset: ${result.changes} rows removed`);
    res.json({ deleted: result.changes });
  } catch (err) {
    console.error("❌ Failed to reset leaderboard:", err);
    res.status(500).json({ error: err.message });
  }
});

// Ensure the `code` column exists in the `promotion_claims` table
try {
  const columns = await allWithRetry(`PRAGMA table_info(promotion_claims)`);
  const hasCodeColumn = columns.some(col => col.name === 'code');

  if (!hasCodeColumn) {
    console.log("Adding missing 'code' column to 'promotion_claims' table...");
    await runWithRetry(`ALTER TABLE promotion_claims ADD COLUMN code TEXT`);
    console.log("✅ 'code' column added successfully.");
  } else {
    console.log("✅ 'code' column already exists.");
  }
} catch (err) {
  console.error("❌ Failed to ensure 'code' column exists:", err.message);
}

// Validate Cloudinary credentials at startup
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error("❌ Missing Cloudinary credentials. Ensure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are set.");
} else if (process.env.CLOUDINARY_API_KEY === 'your_api_key_here') {
  console.error("❌ Placeholder Cloudinary API key detected. Replace 'your_api_key_here' with your actual API key.");
} else {
  console.log("✅ Cloudinary credentials loaded successfully.");
}

// Validate Google Maps API key
if (!process.env.GOOGLE_MAPS_API_KEY) {
  console.error("❌ Missing Google Maps API key. Ensure GOOGLE_MAPS_API_KEY is set.");
} else if (process.env.GOOGLE_MAPS_API_KEY === 'your_google_maps_api_key_here') {
  console.error("❌ Placeholder Google Maps API key detected. Replace 'your_google_maps_api_key_here' with your actual API key.");
} else {
  console.log("✅ Google Maps API key loaded successfully.");
}
