// netlify/functions/send-guide.js
// Sends the Locums Financial Roadmap PDF to new guide leads via Resend

const GUIDE_URL = 'https://locumslab.com/CRNA_Guide_to_Going_Locums_LocumsLab.pdf';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { name, email, role } = body;

  if (!email || !email.includes('@')) {
    return { statusCode: 400, body: 'Valid email required' };
  }

  const firstName = name ? name.split(' ')[0] : 'there';
  const roleLabel = {
    crna: 'CRNA',
    srna: 'SRNA',
    np: 'NP',
    pa: 'PA',
    physician: 'physician',
    other: 'provider'
  }[role] || 'provider';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, 'Segoe UI', sans-serif; color: #0f172a; line-height: 1.6; margin: 0; padding: 0; background: #f8fafc; }
    .wrapper { max-width: 560px; margin: 40px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { background: #0a2540; padding: 32px 40px; }
    .logo { font-size: 1.25rem; font-weight: 700; color: white; letter-spacing: -0.02em; }
    .body { padding: 36px 40px; }
    .body h1 { font-size: 1.375rem; color: #0a2540; margin-bottom: 16px; font-weight: 700; }
    .body p { color: #475569; margin-bottom: 16px; font-size: 0.9375rem; }
    .download-btn { display: inline-block; background: #00a86b; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 1rem; margin: 8px 0 24px; }
    .chapters { background: #f8fafc; border-radius: 8px; padding: 20px 24px; margin-bottom: 24px; }
    .chapters p { color: #0a2540; font-weight: 600; font-size: 0.875rem; margin-bottom: 10px; }
    .chapters ul { margin: 0; padding-left: 20px; }
    .chapters li { color: #475569; font-size: 0.875rem; margin-bottom: 4px; }
    .cta-box { background: #e6f7f1; border-radius: 8px; padding: 20px 24px; margin-bottom: 24px; }
    .cta-box p { margin-bottom: 12px; color: #0a2540; font-weight: 600; }
    .cta-link { color: #0066cc; text-decoration: none; font-weight: 600; font-size: 0.9375rem; }
    .footer { padding: 24px 40px; border-top: 1px solid #e2e8f0; }
    .footer p { font-size: 0.8125rem; color: #94a3b8; margin-bottom: 4px; }
    .footer a { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="logo">LocumsLab</div>
    </div>
    <div class="body">
      <h1>Hey ${firstName} — here's your guide 👋</h1>
      <p>Thanks for downloading <strong>The Locums Financial Roadmap</strong>. 
      As a ${roleLabel} considering the 1099 path, this covers everything you need to 
      understand before making the move — LLC setup, SE taxes, malpractice, and how 
      to put up to $70,000/year into retirement.</p>

      <a href="${GUIDE_URL}" class="download-btn">📥 Download Your Guide</a>

      <div class="chapters">
        <p>What's inside (11 chapters):</p>
        <ul>
          <li>LLC & S-Corp setup — when and how</li>
          <li>Self-employment tax — 2025 rates and deductions</li>
          <li>Malpractice insurance — claims-made vs occurrence</li>
          <li>Benefits gap — what to budget when benefits disappear</li>
          <li>Solo 401(k) vs SEP-IRA — the $70k/year opportunity</li>
          <li>Finding contracts and working with recruiters</li>
          <li>Payroll, bookkeeping, and quarterly tax routine</li>
          <li>How to find a CPA who actually understands locums</li>
        </ul>
      </div>

      <div class="cta-box">
        <p>Ready to run your actual numbers?</p>
        <a href="https://locumslab.com/app.html?start=quickstart" class="cta-link">
          Try the free Quick Start Wizard at LocumsLab →
        </a>
      </div>

      <p>I built LocumsLab because I'm going through this same transition. 
      If anything in the guide is confusing or you have questions, 
      just reply to this email — I read every one.</p>

      <p style="color: #0a2540; font-weight: 600;">— The LocumsLab Team</p>
    </div>
    <div class="footer">
      <p>You're receiving this because you downloaded the Locums Financial Roadmap at locumslab.com.</p>
      <p><a href="https://locumslab.com/unsubscribe.html?email=${encodeURIComponent(email)}">Unsubscribe</a> &nbsp;|&nbsp; <a href="https://locumslab.com/privacy.html">Privacy Policy</a></p>
    </div>
  </div>
</body>
</html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: 'LocumsLab <hello@locumslab.com>',
        to: email,
        reply_to: 'hello@locumslab.com',
        subject: '📥 Your Locums Financial Roadmap is here',
        html
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend error:', err);
      return { statusCode: 500, body: 'Email send failed' };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };

  } catch (err) {
    console.error('send-guide error:', err);
    return { statusCode: 500, body: 'Server error' };
  }
};
