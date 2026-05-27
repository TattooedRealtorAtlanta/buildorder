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
      const paidAt = new Date().toISOString();
      const amountPaid = (session.amount_total || 0) / 100;

      // Fetch link to get the invoice reference_id before updating
      const { data: link } = await db
        .from('share_links')
        .select('reference_id')
        .eq('token', shareToken)
        .single();

      // Mark share link as paid
      const { error } = await db
        .from('share_links')
        .update({ paid_at: paidAt })
        .eq('token', shareToken);

      if (error) {
        console.error('Failed to mark share link as paid:', error.message);
      }

      // Update the invoice with partial or full payment
      if (link && link.reference_id) {
        // Fetch current invoice to get total and existing deposit_paid
        const { data: invoice } = await db
          .from('invoices')
          .select('total, deposit_paid')
          .eq('id', link.reference_id)
          .single();

        if (invoice) {
          const invoiceTotal = Number(invoice.total || 0);
          const existingDeposit = Number(invoice.deposit_paid || 0);
          const newDepositPaid = Math.round((existingDeposit + amountPaid) * 100) / 100;
          const newBalanceDue = Math.round((invoiceTotal - newDepositPaid) * 100) / 100;

          const invoiceUpdate = newBalanceDue <= 0.005
            ? { status: 'paid', deposit_paid: invoiceTotal, balance_due: 0 }
            : { status: 'partial', deposit_paid: newDepositPaid, balance_due: newBalanceDue };

          const { error: invErr } = await db
            .from('invoices')
            .update(invoiceUpdate)
            .eq('id', link.reference_id);

          if (invErr) {
            console.error('Failed to update invoice payment:', invErr.message);
          }
        } else {
          // Fallback: just mark paid if we can't fetch the invoice
          const { error: invErr } = await db
            .from('invoices')
            .update({ status: 'paid' })
            .eq('id', link.reference_id);

          if (invErr) {
            console.error('Failed to mark invoice as paid (fallback):', invErr.message);
          }
        }
      }
    }
  }

  return res.status(200).json({ received: true });
};
