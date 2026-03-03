const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const userId = session.metadata?.userId || session.client_reference_id;

    if (!userId) {
      console.error('No userId found in session metadata');
      return { statusCode: 400, body: 'No userId' };
    }

    const { error } = await supabase
      .from('users')
      .update({
        is_pro: true,
        stripe_customer_id: session.customer,
      })
      .eq('id', userId);

    if (error) {
      console.error('Supabase update error:', error.message);
      return { statusCode: 500, body: 'Database update failed' };
    }

    console.log(`User ${userId} upgraded to Pro`);
  }

  return { statusCode: 200, body: 'ok' };
};
