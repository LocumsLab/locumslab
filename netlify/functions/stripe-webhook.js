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

  // Deduplicate — ignore events we've already processed
  const { error: dedupError } = await supabase
    .from('stripe_events')
    .insert({ event_id: stripeEvent.id, type: stripeEvent.type });

  if (dedupError) {
    // Duplicate key = already processed
    console.log('Duplicate event, skipping:', stripeEvent.id);
    return { statusCode: 200, body: 'Already processed' };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const userId = session.metadata?.userId || session.client_reference_id;

    if (!userId) {
      console.error('No userId found in session');
      return { statusCode: 400, body: 'No userId' };
    }

    // Update stripe_customer_id in users table
    await supabase
      .from('users')
      .update({ stripe_customer_id: session.customer })
      .eq('id', userId);

    // Upsert entitlement — service role only, users cannot do this
    const { error } = await supabase
      .from('entitlements')
      .upsert({
        user_id: userId,
        plan: 'pro',
        status: 'active',
        source: 'stripe',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (error) {
      console.error('Entitlement upsert error:', error.message);
      return { statusCode: 500, body: 'Database update failed' };
    }

    console.log(`User ${userId} upgraded to Pro via entitlements`);
  }

  return { statusCode: 200, body: 'ok' };
};
