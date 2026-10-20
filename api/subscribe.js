// Newsletter signup: adds the email to Resend contacts and to a Mailjet contact list.
// Env: RESEND_API_KEY (+ optional RESEND_SEGMENT_ID) and MAILJET_API_KEY, MAILJET_SECRET_KEY, MAILJET_LIST_ID.
// A service whose variables are missing is skipped. The signup succeeds if at least one service accepts it.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function addToResend(email) {
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
  if (r.ok) return;
  const detail = await r.text();
  // Signing up twice is fine — treat an existing contact as success.
  if (r.status === 409 || /already exists/i.test(detail)) return;
  throw new Error(`Resend error ${r.status} ${detail}`);
}

async function addToMailjet(email) {
  const auth = Buffer.from(`${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET_KEY}`).toString("base64");
  const r = await fetch(
    `https://api.mailjet.com/v3/REST/contactslist/${encodeURIComponent(process.env.MAILJET_LIST_ID)}/managecontact`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      // addnoforce: add to the list, but never re-subscribe someone who unsubscribed.
      body: JSON.stringify({ Email: email, Action: "addnoforce" }),
    }
  );
  if (r.ok) return;
  throw new Error(`Mailjet error ${r.status} ${await r.text()}`);
}

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

  const services = [];
  if (process.env.RESEND_API_KEY) services.push(["Resend", addToResend]);
  if (process.env.MAILJET_API_KEY && process.env.MAILJET_SECRET_KEY && process.env.MAILJET_LIST_ID) {
    services.push(["Mailjet", addToMailjet]);
  }

  if (!services.length) {
    console.error("No signup service is configured");
    return res.status(500).json({ error: "Signup is not available right now. Please try again later." });
  }

  const results = await Promise.allSettled(services.map(([, add]) => add(email)));
  results.forEach((result, i) => {
    if (result.status === "rejected") console.error(`${services[i][0]} failed:`, result.reason.message);
  });

  if (results.some((result) => result.status === "fulfilled")) return res.status(200).json({ ok: true });
  return res.status(502).json({ error: "Something went wrong. Please try again later." });
};
