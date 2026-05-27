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

  // ── GET: return OAuth URL + current connect status ──────────────────────
  if (req.method === 'GET') {
    const { data: profile } = await db
      .from('contractor_profiles')
      .select('stripe_account_id')
      .eq('id', user.id)
      .single();

    const clientId = process.env.STRIPE_CLIENT_ID;
    const redirectUri = 'https://buildorder.ai/settings.html';
    const oauthUrl = `https://connect.stripe.com/express/oauth/authorize?response_type=code&client_id=${clientId}&scope=read_write&redirect_uri=${encodeURIComponent(redirectUri)}&state=${user.id}`;

    return res.status(200).json({
      connected: !!(profile && profile.stripe_account_id),
      stripe_account_id: profile ? profile.stripe_account_id : null,
      oauth_url: oauthUrl
    });
  }

  // ── POST: exchange OAuth code for Stripe account ID ─────────────────────
  if (req.method === 'POST') {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Missing code' });

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    try {
      const response = await stripe.oauth.token({
        grant_type: 'authorization_code',
        code
      });
      const stripeAccountId = response.stripe_user_id;

      const { error: updateErr } = await db
        .from('contractor_profiles')
        .update({ stripe_account_id: stripeAccountId })
        .eq('id', user.id);

      if (updateErr) return res.status(500).json({ error: updateErr.message });

      return res.status(200).json({ success: true, stripe_account_id: stripeAccountId });
    } catch (e) {
      return res.status(400).json({ error: e.message });
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
