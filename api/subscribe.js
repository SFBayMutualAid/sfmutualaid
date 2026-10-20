// Newsletter signup: adds the email as a Resend contact.
// Env: RESEND_API_KEY (required), RESEND_SEGMENT_ID (optional — also adds the contact to that segment).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = req.body || {};
  // Honeypot: real visitors never see or fill this field.
  if (body.website) return res.status(200).json({ ok: true });

  const email = String(body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: "Please enter a valid email address." });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set");
    return res.status(500).json({ error: "Signup is not available right now. Please try again later." });
  }

  const contact = { email, unsubscribed: false };
  if (process.env.RESEND_SEGMENT_ID) contact.segments = [{ id: process.env.RESEND_SEGMENT_ID }];

  const r = await fetch("https://api.resend.com/contacts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(contact),
  });

  if (r.ok) return res.status(200).json({ ok: true });

  const detail = await r.text();
  // Signing up twice is fine — treat an existing contact as success.
  if (r.status === 409 || /already exists/i.test(detail)) return res.status(200).json({ ok: true });

  console.error("Resend error", r.status, detail);
  return res.status(502).json({ error: "Something went wrong. Please try again later." });
};
