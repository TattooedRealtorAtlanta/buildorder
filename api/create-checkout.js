const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { plan } = req.body || {};
  if (!plan || !['pro', 'business'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan. Must be pro or business.' });
  }

  // Get user from auth header
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { data: profile } = await supabase
    .from('contractor_profiles').select('*').eq('id', user.id).single();
  if (!profile) return res.status(404).json({ error: 'Profile not found' });

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  // Reuse existing Stripe customer or create one
  let customerId = profile.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile.email,
      name: profile.contractor_name,
      metadata: { user_id: user.id }
    });
    customerId = customer.id;
    await supabase.from('contractor_profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id);
  }

  const priceId = plan === 'pro'
    ? process.env.STRIPE_PRO_PRICE_ID
    : process.env.STRIPE_BUSINESS_PRICE_ID;

  const origin = req.headers.origin || 'https://buildorder.ai';

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/dashboard.html?upgraded=true`,
    cancel_url: `${origin}/pricing.html?cancelled=true`,
    metadata: { user_id: user.id, plan }
  });

  return res.status(200).json({ url: session.url });
};
