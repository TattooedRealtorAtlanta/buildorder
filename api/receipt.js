const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const jwt = (req.headers.authorization || '').replace('Bearer ', '');
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { invoice_id } = req.body || {};
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id required' });

  const [invRes, profRes] = await Promise.all([
    db.from('invoices').select('*').eq('id', invoice_id).eq('user_id', user.id).single(),
    db.from('contractor_profiles').select('contractor_name, business_name, email, phone').eq('id', user.id).single()
  ]);

  if (invRes.error || !invRes.data) return res.status(404).json({ error: 'Invoice not found' });
  const inv = invRes.data;
  const prof = profRes.data || {};
  const bizName = prof.business_name || prof.contractor_name || 'Your contractor';

  if (!inv.homeowner_email) return res.status(200).json({ sent: false, reason: 'No client email on invoice' });

  const fmtMoney = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const clientName = inv.homeowner_name || 'there';
  const workType = inv.work_type || 'Services';
  const totalPaid = fmtMoney(inv.total);

  try {
    await resend.emails.send({
      from: bizName + ' via BuildOrder <noreply@buildorder.ai>',
      to: [inv.homeowner_email],
      reply_to: prof.email || undefined,
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
      <p style="font-size:14px;color:#6B7280;line-height:1.7;margin:0 0 24px;">
        Your payment has been received and recorded. Here's your receipt for ${workType}.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        ${inv.doc_number ? `<tr style="background:#f9fafb;"><td style="padding:10px 12px;font-weight:600;color:#374151;">Invoice #</td><td style="padding:10px 12px;color:#111827;">${inv.doc_number}</td></tr>` : ''}
        <tr><td style="padding:10px 12px;font-weight:600;color:#374151;">Service</td><td style="padding:10px 12px;color:#111827;">${workType}</td></tr>
        ${inv.job_city ? `<tr style="background:#f9fafb;"><td style="padding:10px 12px;font-weight:600;color:#374151;">Location</td><td style="padding:10px 12px;color:#111827;">${inv.job_city}${inv.job_state ? ', ' + inv.job_state : ''}</td></tr>` : ''}
        <tr ${inv.job_city ? '' : 'style="background:#f9fafb;"'}><td style="padding:10px 12px;font-weight:600;color:#374151;">Amount Paid</td><td style="padding:10px 12px;font-weight:800;color:#059669;font-size:16px;">${totalPaid}</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:10px 12px;font-weight:600;color:#374151;">Date</td><td style="padding:10px 12px;color:#111827;">${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</td></tr>
      </table>
      ${prof.phone ? `<p style="font-size:13px;color:#6B7280;margin:0 0 4px;"><strong>Phone:</strong> ${prof.phone}</p>` : ''}
      ${prof.email ? `<p style="font-size:13px;color:#6B7280;margin:0 0 16px;"><strong>Email:</strong> <a href="mailto:${prof.email}" style="color:#F59E0B;">${prof.email}</a></p>` : ''}
      <p style="font-size:11px;color:#9CA3AF;margin:24px 0 0;line-height:1.6;">
        Please save this email for your records.<br>
        Sent via <a href="https://buildorder.ai" style="color:#F59E0B;text-decoration:none;">BuildOrder.ai</a> on behalf of ${bizName}
      </p>
    </div>
  </div>
</body></html>`
    });

    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('Receipt email failed:', err.message);
    return res.status(500).json({ error: 'Email send failed', detail: err.message });
  }
};
