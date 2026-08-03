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
        subject: 'Welcome to LocumsLab — where to start',
        html: `
          <div style="font-family: Inter, -apple-system, Segoe UI, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #10253f;">
            <div style="margin-bottom: 32px;">
              <span style="font-size: 1.25rem; font-weight: 800; color: #12835c;">LocumsLab</span>
            </div>

            <p style="font-size: 1rem; line-height: 1.7; margin-bottom: 24px;">Hi there,</p>

            <p style="font-size: 1rem; line-height: 1.7; margin-bottom: 28px;">
              Most people land here holding an offer and a vague sense that the numbers should be
              better than they look. Here's the order I'd work through it.
            </p>

            <p style="font-weight: 700; margin-bottom: 6px; font-size: 1rem;">1. Is locums even worth it for you?</p>
            <p style="font-size: 0.9375rem; line-height: 1.7; color: #5b6573; margin: 0 0 20px;">
              Start with <strong style="color: #10253f;">Quick Start</strong>. It compares your current W-2 package
              against a target locums rate, including the benefits you'd be giving up. If the answer is no,
              better to find out now.
            </p>

            <p style="font-weight: 700; margin-bottom: 6px; font-size: 1rem;">2. What does the offer actually pay?</p>
            <p style="font-size: 0.9375rem; line-height: 1.7; color: #5b6573; margin: 0 0 20px;">
              <strong style="color: #10253f;">True Hourly Rate</strong>. A posted rate is not your rate. After
              self-employment tax, health insurance, malpractice, unpaid travel time, and the benefits gap,
              a $230/hr contract often lands closer to $160.
            </p>

            <p style="font-weight: 700; margin-bottom: 6px; font-size: 1rem;">3. What changes once you're 1099?</p>
            <p style="font-size: 0.9375rem; line-height: 1.7; color: #5b6573; margin: 0 0 20px;">
              The <strong style="color: #10253f;">Tax Estimator</strong> gives you quarterly numbers and generates
              an email you can send your CPA with the figures already filled in.
            </p>

            <p style="font-weight: 700; margin-bottom: 6px; font-size: 1rem;">4. Read the guide.</p>
            <p style="font-size: 0.9375rem; line-height: 1.7; color: #5b6573; margin: 0 0 28px;">
              Eleven chapters on entity setup, malpractice and tail coverage, retirement, and finding a CPA who
              actually works with 1099 clinicians. Free, in the Guide tab.
            </p>

            <div style="margin: 32px 0;">
              <a href="https://locumslab.com/app.html" style="background: #12835c; color: white; padding: 14px 28px; border-radius: 999px; text-decoration: none; font-weight: 700; font-size: 0.9375rem;">
                Open LocumsLab →
              </a>
            </div>

            <div style="background: #fbf7ef; border: 1px solid #e5e0d7; border-radius: 12px; padding: 20px; margin-bottom: 28px;">
              <p style="font-weight: 700; margin: 0 0 8px; font-size: 0.9375rem;">Holding an actual contract?</p>
              <p style="font-size: 0.9375rem; line-height: 1.7; color: #5b6573; margin: 0;">
                <strong style="color: #10253f;">Contract Review</strong> reads the agreement and flags restrictive
                covenants, unclear tail coverage, vague termination notice, and payment terms that aren't spelled out.
                It then drafts the email to send your recruiter with the specific questions worth asking. That's part
                of Pro, along with the S-Corp Evaluator, market benchmarks, and side-by-side offer comparison.
                One-time payment, no subscription.
              </p>
            </div>

            <p style="font-size: 0.9375rem; line-height: 1.7; color: #5b6573; margin-bottom: 24px;">
              One thing worth saying plainly: these tools will sometimes tell you your W-2 job is the better deal.
              That's the point. I'm a practicing CRNA, not a recruiter, and I don't get paid when you sign something.
            </p>

            <p style="font-size: 1rem; line-height: 1.7; margin-bottom: 8px;">
              If a number looks wrong or something doesn't add up, just reply. I read them.
            </p>

            <p style="font-size: 1rem; line-height: 1.7;">— Greg, CRNA</p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 40px 0;" />
            <p style="font-size: 0.8125rem; color: #9ca3af; line-height: 1.6;">
              You're receiving this because you created an account at
              <a href="https://locumslab.com" style="color: #12835c;">locumslab.com</a>.
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
        subject: 'Welcome to LocumsLab — where to start',
        html: `
          <div style="font-family: Inter, -apple-system, Segoe UI, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; color: #10253f;">
            <div style="margin-bottom: 32px;">
              <span style="font-size: 1.25rem; font-weight: 800; color: #12835c;">LocumsLab</span>
            </div>

            <p style="font-size: 1rem; line-height: 1.7; margin-bottom: 24px;">Hi there,</p>

            <p style="font-size: 1rem; line-height: 1.7; margin-bottom: 28px;">
              Most people land here holding an offer and a vague sense that the numbers should be
              better than they look. Here's the order I'd work through it.
            </p>

            <p style="font-weight: 700; margin-bottom: 6px; font-size: 1rem;">1. Is locums even worth it for you?</p>
            <p style="font-size: 0.9375rem; line-height: 1.7; color: #5b6573; margin: 0 0 20px;">
              Start with <strong style="color: #10253f;">Quick Start</strong>. It compares your current W-2 package
              against a target locums rate, including the benefits you'd be giving up. If the answer is no,
              better to find out now.
            </p>

            <p style="font-weight: 700; margin-bottom: 6px; font-size: 1rem;">2. What does the offer actually pay?</p>
            <p style="font-size: 0.9375rem; line-height: 1.7; color: #5b6573; margin: 0 0 20px;">
              <strong style="color: #10253f;">True Hourly Rate</strong>. A posted rate is not your rate. After
              self-employment tax, health insurance, malpractice, unpaid travel time, and the benefits gap,
              a $230/hr contract often lands closer to $160.
            </p>

            <p style="font-weight: 700; margin-bottom: 6px; font-size: 1rem;">3. What changes once you're 1099?</p>
            <p style="font-size: 0.9375rem; line-height: 1.7; color: #5b6573; margin: 0 0 20px;">
              The <strong style="color: #10253f;">Tax Estimator</strong> gives you quarterly numbers and generates
              an email you can send your CPA with the figures already filled in.
            </p>

            <p style="font-weight: 700; margin-bottom: 6px; font-size: 1rem;">4. Read the guide.</p>
            <p style="font-size: 0.9375rem; line-height: 1.7; color: #5b6573; margin: 0 0 28px;">
              Eleven chapters on entity setup, malpractice and tail coverage, retirement, and finding a CPA who
              actually works with 1099 clinicians. Free, in the Guide tab.
            </p>

            <div style="margin: 32px 0;">
              <a href="https://locumslab.com/app.html" style="background: #12835c; color: white; padding: 14px 28px; border-radius: 999px; text-decoration: none; font-weight: 700; font-size: 0.9375rem;">
                Open LocumsLab →
              </a>
            </div>

            <div style="background: #fbf7ef; border: 1px solid #e5e0d7; border-radius: 12px; padding: 20px; margin-bottom: 28px;">
              <p style="font-weight: 700; margin: 0 0 8px; font-size: 0.9375rem;">Holding an actual contract?</p>
              <p style="font-size: 0.9375rem; line-height: 1.7; color: #5b6573; margin: 0;">
                <strong style="color: #10253f;">Contract Review</strong> reads the agreement and flags restrictive
                covenants, unclear tail coverage, vague termination notice, and payment terms that aren't spelled out.
                It then drafts the email to send your recruiter with the specific questions worth asking. That's part
                of Pro, along with the S-Corp Evaluator, market benchmarks, and side-by-side offer comparison.
                One-time payment, no subscription.
              </p>
            </div>

            <p style="font-size: 0.9375rem; line-height: 1.7; color: #5b6573; margin-bottom: 24px;">
              One thing worth saying plainly: these tools will sometimes tell you your W-2 job is the better deal.
              That's the point. I'm a practicing CRNA, not a recruiter, and I don't get paid when you sign something.
            </p>

            <p style="font-size: 1rem; line-height: 1.7; margin-bottom: 8px;">
              If a number looks wrong or something doesn't add up, just reply. I read them.
            </p>

            <p style="font-size: 1rem; line-height: 1.7;">— Greg, CRNA</p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 40px 0;" />
            <p style="font-size: 0.8125rem; color: #9ca3af; line-height: 1.6;">
              You're receiving this because you created an account at
              <a href="https://locumslab.com" style="color: #12835c;">locumslab.com</a>.
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
