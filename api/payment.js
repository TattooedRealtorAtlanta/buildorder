const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { share_token } = req.body || {};
  if (!share_token) return res.status(400).json({ error: 'Missing share_token' });

  // Fetch the share link
  const { data: link, error: linkErr } = await db
    .from('share_links')
    .select('id, token, reference_id, payment_amount, paid_at, user_id, document_type')
    .eq('token', share_token)
    .single();

  if (linkErr || !link) return res.status(404).json({ error: 'Link not found' });
  if (link.paid_at) return res.status(409).json({ error: 'Already paid' });
  if (!link.payment_amount || Number(link.payment_amount) <= 0) {
    return res.status(400).json({ error: 'No payment amount set on this link' });
  }

  // Fetch contractor's connected Stripe account
  const { data: profile } = await db
    .from('contractor_profiles')
    .select('stripe_account_id, business_name, contractor_name')
    .eq('id', link.user_id)
    .single();

  if (!profile || !profile.stripe_account_id) {
    return res.status(400).json({ error: 'Contractor has not connected Stripe' });
  }

  const amountCents = Math.round(Number(link.payment_amount) * 100);
  const bizName = profile.business_name || profile.contractor_name || 'Contractor';
  const invoiceRef = link.reference_id || link.token.slice(0, 8).toUpperCase();

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Invoice Payment — ${bizName}`,
            description: `Invoice #${invoiceRef}`
          },
          unit_amount: amountCents
        },
        quantity: 1
      }],
      mode: 'payment',
      payment_intent_data: {
        transfer_data: {
          destination: profile.stripe_account_id
        }
      },
      metadata: {
        share_token: link.token,
        reference_id: link.reference_id || ''
      },
      success_url: `https://buildorder.ai/sign.html?token=${encodeURIComponent(link.token)}&paid=1`,
      cancel_url:  `https://buildorder.ai/sign.html?token=${encodeURIComponent(link.token)}`
    });

    return res.status(200).json({ checkout_url: session.url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
