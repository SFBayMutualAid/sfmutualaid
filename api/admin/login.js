// POST {password} logs in (sets the session cookie), DELETE logs out, GET reports whether you're logged in.

const { verifyPassword, sessionCookie, clearCookie, isLoggedIn } = require("./_lib");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") return res.status(200).json({ loggedIn: isLoggedIn(req) });

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearCookie());
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.ADMIN_PASSWORD_HASH || !process.env.ADMIN_SESSION_SECRET) {
    return res.status(500).json({ error: "Admin login is not set up on the server." });
  }

  const password = String((req.body || {}).password || "");
  if (!verifyPassword(password)) {
    // Slow down guessing.
    await new Promise((r) => setTimeout(r, 1000));
    return res.status(401).json({ error: "Wrong password." });
  }

  res.setHeader("Set-Cookie", sessionCookie());
  return res.status(200).json({ ok: true });
};
