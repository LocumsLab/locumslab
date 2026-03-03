const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    console.log('STRIPE_SECRET_KEY present:', !!process.env.STRIPE_SECRET_KEY);
    console.log('STRIPE_SECRET_KEY length:', process.env.STRIPE_SECRET_KEY?.length);
    console.log('STRIPE_SECRET_KEY starts with:', process.env.STRIPE_SECRET_KEY?.substring(0, 12));
    console.log('STRIPE_PRICE_ID:', process.env.STRIPE_PRICE_ID);

    const { userId, email } = JSON.parse(event.body);
    console.log('userId:', userId, 'email:', email);

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: email,
      client_reference_id: userId,
      success_url: 'https://locumslab.com/app.html?upgrade=success',
      cancel_url: 'https://locumslab.com/app.html?upgrade=cancelled',
      metadata: {
        userId: userId,
      },
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };

  } catch (err) {
    console.error('Checkout error type:', err.type);
    console.error('Checkout error message:', err.message);
    console.error('Checkout error status:', err.statusCode);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
