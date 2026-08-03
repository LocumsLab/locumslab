const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// The Price lives in Stripe, not here. To change what Pro costs, create a new
// Price in the Stripe dashboard and update this env var — no redeploy of logic.
// Falls back to the current Pro price ID if the env var is unset.
const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID || 'price_1U0AEr41xSRMn4Y38hmaPhN7';

const SITE_URL = process.env.SITE_URL || 'https://locumslab.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    const { userId, email } = JSON.parse(event.body || '{}');

    if (!userId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'User ID required' })
      };
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price: PRO_PRICE_ID,
          quantity: 1
        }
      ],

      // app.html reads ?upgrade=success on load and refreshes entitlements
      success_url: `${SITE_URL}/app.html?upgrade=success`,
      cancel_url: `${SITE_URL}/app.html`,

      // Prefill so the buyer doesn't retype it, and so Stripe can match
      // the customer record to the account.
      customer_email: email || undefined,

      // The webhook reads userId from metadata first, then client_reference_id.
      // Both are set so a change to either side can't orphan the payment.
      client_reference_id: userId,
      metadata: {
        userId: userId,
        product: 'pro'
      },

      allow_promotion_codes: true
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: session.url, sessionId: session.id })
    };

  } catch (error) {
    console.error('Stripe checkout error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Checkout creation failed' })
    };
  }
};
