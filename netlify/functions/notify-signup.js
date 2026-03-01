const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL; // your email

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };

  const payload = JSON.parse(event.body);
  const user = payload.record;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'alerts@locumslab.com',
      to: NOTIFY_EMAIL,
      subject: '🎉 New LocumsLab signup!',
      text: `New user signed up!\n\nEmail: ${user.email}\nTime: ${user.created_at}\nUser ID: ${user.id}`,
    }),
  });

  return { statusCode: 200, body: 'ok' };
};
