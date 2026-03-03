const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { email, subject, message } = JSON.parse(event.body);

    if (!email || !message) {
      return { statusCode: 400, body: 'Missing fields' };
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'hello@locumslab.com',
        to: NOTIFY_EMAIL,
        reply_to: email,
        subject: `LocumsLab Contact: ${subject}`,
        text: `From: ${email}\nSubject: ${subject}\n\n${message}`,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error('Resend error:', error);
      return { statusCode: 500, body: 'Email failed' };
    }

    return { statusCode: 200, body: 'ok' };

  } catch (err) {
    console.error('Contact function error:', err);
    return { statusCode: 500, body: 'Server error' };
  }
};
