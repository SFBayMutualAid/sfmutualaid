// GET: list every editable page in the repo.
// GET ?path=about/index.html: that page's current HTML and sha.
// PUT {path, sha, html, message}: commit the new HTML to the repo, which redeploys the site.

const { BRANCH, isEditablePath, requireAdmin, github } = require("./_lib");

async function listPages() {
  const tree = await github(`/git/trees/${BRANCH}?recursive=1`);
  return tree.tree
    .filter((f) => f.type === "blob" && isEditablePath(f.path))
    .map((f) => ({ path: f.path, url: f.path === "index.html" ? "/" : "/" + f.path.replace(/index\.html$/, "") }))
    .sort((a, b) => (a.url === "/" ? -1 : b.url === "/" ? 1 : a.url.localeCompare(b.url)));
}

async function readPage(path) {
  const f = await github(`/contents/${path}?ref=${BRANCH}`);
  return { path, sha: f.sha, html: Buffer.from(f.content, "base64").toString("utf8") };
}

async function savePage({ path, sha, html, message }) {
  const r = await github(`/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({
      message: String(message || "").trim().slice(0, 200) || `Edit ${path} from admin`,
      content: Buffer.from(html, "utf8").toString("base64"),
      sha,
      branch: BRANCH,
    }),
  });
  return { path, sha: r.content.sha, commit: r.commit.sha };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === "GET") {
      const path = req.query.path;
      if (!path) return res.status(200).json({ pages: await listPages() });
      if (!isEditablePath(path)) return res.status(400).json({ error: "That page can't be edited here." });
      return res.status(200).json(await readPage(path));
    }

    if (req.method === "PUT") {
      const body = req.body || {};
      if (!isEditablePath(body.path)) return res.status(400).json({ error: "That page can't be edited here." });
      if (typeof body.html !== "string" || !body.html.trim()) return res.status(400).json({ error: "The page is empty." });
      if (typeof body.sha !== "string") return res.status(400).json({ error: "Missing page version." });
      if (body.html.length > 1_000_000) return res.status(413).json({ error: "The page is too large." });
      return res.status(200).json(await savePage(body));
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("admin pages", err);
    if (err.status === 409) {
      return res.status(409).json({ error: "This page changed since you opened it. Reload it, then make your edit again." });
    }
    return res.status(502).json({ error: err.message || "Something went wrong." });
  }
};
