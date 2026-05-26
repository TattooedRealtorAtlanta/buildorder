const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

// Disable body parsing — Stripe needs the raw body to verify the signature
export const config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => resolve(Buffer.from(data)));
    req.on('error', reject);
  });
}

const PLAN_MAP = {
  [process.env.STRIPE_PRO_PRICE_ID]: 'pro',
  [process.env.STRIPE_BUSINESS_PRICE_ID]: 'business',
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  async function updatePlan(customerId, plan, subscriptionId) {
    await supabase
      .from('contractor_profiles')
      .update({ plan, stripe_subscription_id: subscriptionId || null })
      .eq('stripe_customer_id', customerId);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.user_id;
      const plan = session.metadata?.plan || 'pro';
      if (userId) {
        await supabase.from('contractor_profiles')
          .update({ plan, stripe_customer_id: session.customer, stripe_subscription_id: session.subscription })
          .eq('id', userId);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const priceId = sub.items?.data?.[0]?.price?.id;
      const plan = PLAN_MAP[priceId] || 'free';
      const isActive = ['active', 'trialing'].includes(sub.status);
      await updatePlan(sub.customer, isActive ? plan : 'free', sub.id);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      await updatePlan(sub.customer, 'free', null);
      break;
    }

    case 'invoice.payment_failed': {
      // Optionally: send a payment failed email here
      console.log('Payment failed for customer:', event.data.object.customer);
      break;
    }

    default:
      // Unhandled event type — that's fine
      break;
  }

  return res.status(200).json({ received: true });
};
