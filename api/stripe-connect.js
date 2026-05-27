const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // All methods require auth
  const authHeader = req.headers.authorization || '';
  const jwt = authHeader.replace('Bearer ', '');
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  // ── GET: generate Account Link for Connect onboarding ──────────────────
  // Uses Stripe Account Links (not legacy OAuth) — no STRIPE_CLIENT_ID needed.
  // Creates a new Express account if the contractor doesn't have one, then
  // generates a Stripe-hosted onboarding URL. Account ID is saved before
  // redirect so it's available when the user returns.
  if (req.method === 'GET') {
    const { data: profile, error: profileErr } = await db
      .from('contractor_profiles')
      .select('stripe_account_id, email, contractor_name, business_name')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile) return res.status(404).json({ error: 'Profile not found' });

    let accountId = profile.stripe_account_id;

    // Create a new Express account if they don't have one yet
    if (!accountId) {
      try {
        const account = await stripe.accounts.create({
          type: 'express',
          email: profile.email || undefined,
          capabilities: {
            card_payments: { requested: true },
            transfers:     { requested: true }
          },
          metadata: { buildorder_user_id: user.id }
        });
        accountId = account.id;

        const { error: saveErr } = await db
          .from('contractor_profiles')
          .update({ stripe_account_id: accountId })
          .eq('id', user.id);

        if (saveErr) {
          console.error('Failed to save stripe_account_id:', saveErr.message);
          return res.status(500).json({ error: 'Could not save account ID' });
        }
      } catch (createErr) {
        console.error('Stripe account create failed:', createErr.message);
        return res.status(500).json({ error: createErr.message });
      }
    }

    // Generate a hosted onboarding link
    try {
      const accountLink = await stripe.accountLinks.create({
        account:     accountId,
        refresh_url: 'https://buildorder.ai/settings.html?connect=refresh',
        return_url:  'https://buildorder.ai/settings.html?connect=success',
        type:        'account_onboarding'
      });
      return res.status(200).json({ oauth_url: accountLink.url });
    } catch (linkErr) {
      console.error('Account link create failed:', linkErr.message);
      return res.status(500).json({ error: linkErr.message });
    }
  }

  // ── DELETE: disconnect Stripe account ───────────────────────────────────
  if (req.method === 'DELETE') {
    const { error: updateErr } = await db
      .from('contractor_profiles')
      .update({ stripe_account_id: null })
      .eq('id', user.id);

    if (updateErr) return res.status(500).json({ error: updateErr.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
