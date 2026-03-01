const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const payload = JSON.parse(event.body);
    const user = payload.record;

    // 1. Notify you of the new signup
    const adminRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'hello@locumslab.com',
        to: NOTIFY_EMAIL,
        subject: '🎉 New LocumsLab signup!',
        text: `New user signed up!\n\nEmail: ${user.email}\nTime: ${user.created_at}\nUser ID: ${user.id}`,
      }),
    });

    if (!adminRes.ok) {
      const error = await adminRes.text();
      console.error('Admin email error:', error);
    }

    // 2. Send welcome email to the new user
    const welcomeRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'hello@locumslab.com',
        to: user.email,
        subject: 'Welcome to LocumsLab 👋',
        html: `
          <div style="font-family: Inter, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #1a1a1a;">
            <div style="margin-bottom: 32px;">
              <span style="font-size: 1.25rem; font-weight: 800; color: #10b981;">LocumsLab</span>
            </div>

            <p style="font-size: 1rem; line-height: 1.7; margin-bottom: 24px;">Hi there,</p>

            <p style="font-size: 1rem; line-height: 1.7; margin-bottom: 24px;">
              You now have access to all 7 free calculators — built specifically for physicians, CRNAs, NPs, and PAs navigating the staff vs. locums decision.
            </p>

            <p style="font-weight: 700; margin-bottom: 12px;">Start here:</p>
            <ul style="padding-left: 20px; margin-bottom: 24px; line-height: 2;">
              <li>Run the W-2 vs 1099 comparison at your actual income</li>
              <li>See how much SE tax you'd owe as a 1099 provider</li>
              <li>Check if an S-Corp makes sense for your situation</li>
            </ul>

            <p style="font-size: 1rem; line-height: 1.7; margin-bottom: 24px;">
              When you're ready to go deeper, Pro unlocks the S-Corp Evaluator, full market benchmarks, side-by-side scenario comparison, and PDF export — all for a one-time $39.
            </p>

            <div style="margin: 32px 0;">
              <a href="https://locumslab.com" style="background: #10b981; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 0.9375rem;">
                Open LocumsLab →
              </a>
            </div>

            <p style="font-size: 1rem; line-height: 1.7; margin-bottom: 8px;">Questions? Just reply to this email.</p>

            <p style="font-size: 1rem; line-height: 1.7;">— The LocumsLab Team</p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 40px 0;" />
            <p style="font-size: 0.8125rem; color: #9ca3af; line-height: 1.6;">
              You're receiving this because you created an account at
              <a href="https://locumslab.com" style="color: #10b981;">locumslab.com</a>.
              This is a transactional email — no spam, ever.
            </p>
          </div>
        `,
      }),
    });

    if (!welcomeRes.ok) {
      const error = await welcomeRes.text();
      console.error('Welcome email error:', error);
    }

    return { statusCode: 200, body: 'ok' };

  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, body: 'Server error' };
  }
};
