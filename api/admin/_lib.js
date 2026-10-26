// Shared helpers for the /admin API: password check, signed session cookie, GitHub contents API.
// Env: ADMIN_PASSWORD_HASH ("scrypt$<salt b64>$<hash b64>"), ADMIN_SESSION_SECRET (long random string),
//      GITHUB_TOKEN (fine-grained token with Contents read/write on the site repo),
//      optional GITHUB_REPO (default SFBayMutualAid/sfmutualaid) and GITHUB_BRANCH (default main).
// Files starting with "_" are not deployed as their own endpoints.

const crypto = require("crypto");

const COOKIE = "sfma_admin";
const SESSION_HOURS = 12;
const REPO = process.env.GITHUB_REPO || "SFBayMutualAid/sfmutualaid";
const BRANCH = process.env.GITHUB_BRANCH || "main";

// Pages the editor may touch: <slug>/index.html or the root index.html, never the admin itself.
const PAGE_RE = /^(?:[a-z0-9][a-z0-9-]*\/)?index\.html$/;
function isEditablePath(path) {
  return typeof path === "string" && PAGE_RE.test(path) && !path.startsWith("admin/");
}

function verifyPassword(password) {
  const stored = process.env.ADMIN_PASSWORD_HASH || "";
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash || typeof password !== "string") return false;
  const expected = Buffer.from(hash, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(salt, "base64"), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function sign(value) {
  return crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(value).digest("base64url");
}

function sessionCookie() {
  const expires = Date.now() + SESSION_HOURS * 3600 * 1000;
  const value = `${expires}.${sign(String(expires))}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}

function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function isLoggedIn(req) {
  if (!process.env.ADMIN_SESSION_SECRET) return false;
  const raw = (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return false;
  const [expires, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  const good = Buffer.from(sign(expires));
  const given = Buffer.from(sig);
  return good.length === given.length && crypto.timingSafeEqual(good, given);
}

// Every state-changing request must come from our own page (custom header + SameSite cookie).
function requireAdmin(req, res) {
  if (!isLoggedIn(req)) {
    res.status(401).json({ error: "Please log in." });
    return false;
  }
  if (req.method !== "GET" && req.headers["x-admin-request"] !== "1") {
    res.status(403).json({ error: "Forbidden." });
    return false;
  }
  return true;
}

async function github(path, options = {}) {
  if (!process.env.GITHUB_TOKEN) throw Object.assign(new Error("GITHUB_TOKEN is not set."), { status: 500 });
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "sfmutualaid-admin",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.message || `GitHub error ${r.status}`), { status: r.status });
  return data;
}

module.exports = { REPO, BRANCH, isEditablePath, verifyPassword, sessionCookie, clearCookie, isLoggedIn, requireAdmin, github };
