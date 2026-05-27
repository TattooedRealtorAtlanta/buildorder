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

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];
  const rawBody = await getRawBody(req);

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_CONNECT_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Payment webhook signature verification failed:', e.message);
    return res.status(400).json({ error: `Webhook error: ${e.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const shareToken = session.metadata && session.metadata.share_token;

    if (shareToken) {
      const { error } = await db
        .from('share_links')
        .update({ paid_at: new Date().toISOString() })
        .eq('token', shareToken);

      if (error) {
        console.error('Failed to mark share link as paid:', error.message);
      }
    }
  }

  return res.status(200).json({ received: true });
};
