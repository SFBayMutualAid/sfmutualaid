// The menu (<header>) and footer shared by every page.
// GET: the homepage's header and footer (with no page marked as current), the homepage HTML for the
//      preview, and the commit they were read from.
// PUT {header, footer, commit, message}: put that header and footer on every page that uses the shared
//      layout, keep each page's own "current page" link highlighted, and publish it all as one commit.

const { BRANCH, isEditablePath, requireAdmin, github } = require("./_lib");

// The site's own header (it holds the #site-nav menu) and footer. Old Squarespace pages don't match.
const HEADER_RE = /<header>(?:(?!<\/header>)[\s\S])*?id="site-nav"[\s\S]*?<\/header>/;
const FOOTER_RE = /<footer>[\s\S]*?<\/footer>/;
const NAV_RE = /<nav\b[^>]*>[\s\S]*?<\/nav>/;

function findLayout(html) {
  const header = html.match(HEADER_RE);
  const footer = html.match(FOOTER_RE);
  if (!header || !footer || footer.index < header.index) return null;
  return { header: header[0], footer: footer[0] };
}

// The menu link a page marks as current (class="on"), if any.
function currentHref(header) {
  const nav = (header.match(NAV_RE) || [""])[0];
  const tag = (nav.match(/<a\b[^>]*\bclass="[^"]*\bon\b[^"]*"[^>]*>/) || [""])[0];
  return (tag.match(/\bhref="([^"]*)"/) || [])[1] || null;
}

// Drop the "current page" marker from every menu link.
function clearCurrent(header) {
  return header.replace(NAV_RE, (nav) =>
    nav.replace(/<a\b[^>]*>/g, (tag) =>
      tag
        .replace(/\bclass="([^"]*)"/, (m, cls) => `class="${cls.split(/\s+/).filter((c) => c && c !== "on").join(" ")}"`)
        .replace(/\s+class=""/, "")
    )
  );
}

// Mark the menu link pointing at href as the current page.
function markCurrent(header, href) {
  if (!href) return header;
  return header.replace(NAV_RE, (nav) => {
    let done = false;
    return nav.replace(/<a\b[^>]*>/g, (tag) => {
      if (done || (tag.match(/\bhref="([^"]*)"/) || [])[1] !== href) return tag;
      done = true;
      return /\bclass="/.test(tag) ? tag.replace(/\bclass="([^"]*)"/, (m, cls) => `class="${(cls + " on").trim()}"`) : tag.replace(/^<a\b/, '<a class="on"');
    });
  });
}

async function readFile(sha) {
  const blob = await github(`/git/blobs/${sha}`);
  return Buffer.from(blob.content, "base64").toString("utf8");
}

async function readLayout() {
  const ref = await github(`/git/ref/heads/${BRANCH}`);
  const commit = ref.object.sha;
  const tree = await github(`/git/trees/${commit}?recursive=1`);
  const home = tree.tree.find((f) => f.path === "index.html");
  const html = await readFile(home.sha);
  const layout = findLayout(html);
  if (!layout) throw Object.assign(new Error("Couldn't find the menu and footer on the homepage."), { status: 500 });
  return { commit, home: html, header: clearCurrent(layout.header), footer: layout.footer };
}

async function saveLayout({ header, footer, commit, message }) {
  const ref = await github(`/git/ref/heads/${BRANCH}`);
  if (ref.object.sha !== commit) throw Object.assign(new Error("stale"), { status: 409 });

  const base = await github(`/git/commits/${commit}`);
  const tree = await github(`/git/trees/${commit}?recursive=1`);
  const files = tree.tree.filter((f) => f.type === "blob" && isEditablePath(f.path));
  const cleanHeader = clearCurrent(header);

  const changes = [];
  for (const f of files) {
    const html = await readFile(f.sha);
    const old = findLayout(html);
    if (!old) continue;
    // Leave pages alone when nothing but stray empty class attributes would change.
    if (clearCurrent(old.header) === cleanHeader && old.footer === footer) continue;
    const next = html
      .replace(old.header, () => markCurrent(cleanHeader, currentHref(old.header)))
      .replace(FOOTER_RE, () => footer);
    if (next !== html) changes.push({ path: f.path, mode: "100644", type: "blob", content: next });
  }
  if (!changes.length) return { commit, changed: [] };

  const newTree = await github("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: base.tree.sha, tree: changes }) });
  const newCommit = await github("/git/commits", {
    method: "POST",
    body: JSON.stringify({
      message: String(message || "").trim().slice(0, 200) || "Edit menu and footer from admin",
      tree: newTree.sha,
      parents: [commit],
    }),
  });
  try {
    await github(`/git/refs/heads/${BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: newCommit.sha, force: false }) });
  } catch (err) {
    // A non-fast-forward update means someone published in the meantime.
    if (err.status === 422) throw Object.assign(new Error("stale"), { status: 409 });
    throw err;
  }
  return { commit: newCommit.sha, changed: changes.map((c) => c.path) };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === "GET") return res.status(200).json(await readLayout());

    if (req.method === "PUT") {
      const body = req.body || {};
      if (typeof body.header !== "string" || !/^<header>[\s\S]*id="site-nav"[\s\S]*<\/header>$/.test(body.header.trim())) {
        return res.status(400).json({ error: 'The menu must be one <header>…</header> block that keeps the <nav id="site-nav"> inside it.' });
      }
      if (typeof body.footer !== "string" || !/^<footer>[\s\S]*<\/footer>$/.test(body.footer.trim())) {
        return res.status(400).json({ error: "The footer must be one <footer>…</footer> block." });
      }
      if (typeof body.commit !== "string") return res.status(400).json({ error: "Missing site version." });
      if (body.header.length + body.footer.length > 100_000) return res.status(413).json({ error: "The menu and footer are too large." });
      return res.status(200).json(await saveLayout({ ...body, header: body.header.trim(), footer: body.footer.trim() }));
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("admin layout", err);
    if (err.status === 409) {
      return res.status(409).json({ error: "The site changed since you opened this. Reload it, then make your edit again." });
    }
    return res.status(502).json({ error: err.message || "Something went wrong." });
  }
};

