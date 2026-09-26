const RESEND_ENDPOINT = "https://api.resend.com/emails";

function fromAddress() {
  return process.env.RESEND_FROM_EMAIL || "Quiz App <onboarding@resend.dev>";
}

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set");
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: fromAddress(), to: [to], subject, html }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend responded ${res.status}: ${detail.slice(0, 300)}`);
  }

  return res.json();
}

export async function sendPasswordResetEmail({ to, username, resetUrl, expiresAt }) {
  const hours = Math.max(
    1,
    Math.round((new Date(expiresAt).getTime() - Date.now()) / 3_600_000)
  );

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f5f2;font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:#1d2433">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid rgba(29,36,51,0.1);border-radius:16px;padding:32px">
      <h1 style="margin:0 0 16px;font-size:22px">Reset your password</h1>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1d2433b3">
        Hi ${escapeHtml(username)}, we received a request to reset the password for
        your account.
      </p>
      <p style="margin:0 0 24px">
        <a href="${escapeHtml(resetUrl)}"
           style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:12px">
          Choose a new password
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:#1d2433a6">
        This link expires in ${hours} hour${hours === 1 ? "" : "s"}
        (${escapeHtml(new Date(expiresAt).toUTCString())}) and can only be used once.
      </p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#1d2433a6">
        If you did not request this, you can safely ignore this email &mdash;
        your password will not change.
      </p>
      <hr style="border:none;border-top:1px solid rgba(29,36,51,0.1);margin:24px 0" />
      <p style="margin:0;font-size:12px;line-height:1.6;color:#1d243380;word-break:break-all">
        If the button does not work, paste this URL into your browser:<br />
        ${escapeHtml(resetUrl)}
      </p>
    </div>
  </body>
</html>`;

  return sendEmail({
    to,
    subject: "Reset your password",
    html,
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
