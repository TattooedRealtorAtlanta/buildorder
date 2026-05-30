const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

// Disable body parsing — Stripe needs the raw body to verify the signature
module.exports.config = { api: { bodyParser: false } };

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => resolve(Buffer.from(data)));
    req.on('error', reject);
  });
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

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
        .select('reference_id, client_email, client_name, user_id')
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

        // Send receipt email to client
        if (link && link.client_email) {
          try {
            const { data: prof } = await db
              .from('contractor_profiles')
              .select('contractor_name, business_name, email, phone, google_review_url')
              .eq('id', link.user_id)
              .single();

            const { data: inv } = await db
              .from('invoices')
              .select('homeowner_name, work_type, doc_number, total, job_city, job_state')
              .eq('id', link.reference_id)
              .single();

            const bizName = (prof && (prof.business_name || prof.contractor_name)) || 'Your contractor';
            const clientName = link.client_name || (inv && inv.homeowner_name) || 'there';
            const fmtAmt = '$' + amountPaid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const workType = (inv && inv.work_type) || 'Services';
            const docNum = (inv && inv.doc_number) || '';
            const location = inv && inv.job_city ? inv.job_city + (inv.job_state ? ', ' + inv.job_state : '') : '';
            const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

            await resend.emails.send({
              from: bizName + ' via BuildOrder <noreply@buildorder.ai>',
              to: [link.client_email],
              reply_to: prof && prof.email ? prof.email : undefined,
              subject: 'Payment Receipt — ' + bizName,
              html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#F1F5F9;margin:0;padding:40px 16px;">
  <div style="max-width:520px;margin:0 auto;">
    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;">
      <div style="font-size:20px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">${bizName}</div>
    </div>
    <div style="background:#fff;border-radius:0 0 14px 14px;padding:32px;border:1px solid #e5e7eb;border-top:none;">
      <div style="display:inline-block;background:rgba(52,211,153,0.12);color:#059669;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;padding:4px 12px;border-radius:100px;margin-bottom:16px;">&#10003; Payment Received</div>
      <h1 style="font-size:20px;font-weight:900;color:#111827;margin:0 0 8px;">Thank you, ${clientName}.</h1>
      <p style="font-size:14px;color:#6B7280;line-height:1.7;margin:0 0 24px;">Your payment of <strong style="color:#111827;">${fmtAmt}</strong> has been received. Here's your receipt.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        ${docNum ? `<tr style="background:#f9fafb;"><td style="padding:10px 12px;font-weight:600;color:#374151;">Invoice #</td><td style="padding:10px 12px;color:#111827;">${docNum}</td></tr>` : ''}
        <tr><td style="padding:10px 12px;font-weight:600;color:#374151;">Service</td><td style="padding:10px 12px;color:#111827;">${workType}</td></tr>
        ${location ? `<tr style="background:#f9fafb;"><td style="padding:10px 12px;font-weight:600;color:#374151;">Location</td><td style="padding:10px 12px;color:#111827;">${location}</td></tr>` : ''}
        <tr style="background:#f9fafb;"><td style="padding:10px 12px;font-weight:600;color:#374151;">Amount Paid</td><td style="padding:10px 12px;font-weight:800;color:#059669;font-size:16px;">${fmtAmt}</td></tr>
        <tr><td style="padding:10px 12px;font-weight:600;color:#374151;">Date</td><td style="padding:10px 12px;color:#111827;">${dateStr}</td></tr>
      </table>
      ${prof && prof.google_review_url ? `<div style="background:#F9FAFB;border-radius:8px;padding:14px 16px;margin-bottom:20px;text-align:center;"><p style="font-size:13px;color:#374151;margin:0 0 8px;font-weight:600;">Happy with the work?</p><a href="${prof.google_review_url}" style="display:inline-block;background:#F59E0B;color:#090E1A;text-decoration:none;font-weight:800;font-size:13px;padding:8px 20px;border-radius:8px;">&#11088; Leave a Google Review</a></div>` : ''}
      <p style="font-size:11px;color:#9CA3AF;margin:0;line-height:1.6;">Please save this email for your records.<br>Sent via <a href="https://buildorder.ai" style="color:#F59E0B;text-decoration:none;">BuildOrder.ai</a> on behalf of ${bizName}</p>
    </div>
  </div>
</body></html>`
            });
          } catch (receiptErr) {
            console.error('Receipt email failed:', receiptErr.message);
          }
        }
      }
    }
  }

  return res.status(200).json({ received: true });
};
