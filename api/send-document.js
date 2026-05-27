const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
const { getEffectivePlan } = require('./_effectivePlan');

const db     = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const TYPE_LABELS = {
  'contract':      'Home Improvement Contract',
  'estimate':      'Estimate',
  'invoice':       'Invoice',
  'change-order':  'Change Order',
  'subcontractor': 'Subcontractor Agreement',
  'lien-waiver':   'Lien Waiver',
  'takeoff':       'Material Takeoff',
  'document':      'Document'
};

const CTA_LABELS = {
  'invoice':  'View & Pay Invoice',
  'estimate': 'View & Sign Estimate',
  'contract': 'View & Sign Contract',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth
  const jwt = (req.headers.authorization || '').replace('Bearer ', '');
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  // Plan check — email delivery is Pro+
  const { data: profile } = await db
    .from('contractor_profiles')
    .select('plan, founding_member, pro_expires_at, contractor_name, business_name, email, phone, license_number')
    .eq('id', user.id)
    .single();

  if (!profile || getEffectivePlan(profile) === 'free') {
    return res.status(402).json({ error: 'upgrade_required', message: 'Email delivery is a Pro feature.' });
  }

  // Accept both to_email (new frontend) and to (legacy)
  const body           = req.body || {};
  const to_email       = body.to_email || body.to;
  const to_name        = body.to_name  || '';
  const subject        = body.subject  || '';
  const content        = body.content  || '';
  const document_type  = body.document_type || 'document';
  const reference_id   = body.reference_id  || null;
  const payment_amount = body.payment_amount || null;

  if (!to_email || !content) return res.status(400).json({ error: 'Missing required fields' });

  const docLabel = TYPE_LABELS[document_type] || 'Document';
  const ctaLabel = CTA_LABELS[document_type]  || 'View Document';
  const bizName  = profile.business_name || profile.contractor_name || 'Your Contractor';

  // ── Get or create share link ─────────────────────────────────────────────
  let shareToken = null;

  if (reference_id) {
    const { data: existing } = await db
      .from('share_links')
      .select('token')
      .eq('user_id', user.id)
      .eq('reference_id', reference_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (existing) shareToken = existing.token;
  }

  if (!shareToken) {
    const insertPayload = {
      user_id:          user.id,
      document_content: content,
      document_type:    document_type,
      client_email:     to_email,
      sent_at:          new Date().toISOString()
    };
    if (reference_id)  insertPayload.reference_id   = reference_id;
    if (payment_amount && Number(payment_amount) > 0) insertPayload.payment_amount = Number(payment_amount);

    const { data: newLink, error: insertErr } = await db
      .from('share_links')
      .insert(insertPayload)
      .select('token')
      .single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });
    shareToken = newLink.token;
  } else {
    // Update existing link with latest email + timestamp
    await db
      .from('share_links')
      .update({ client_email: to_email, sent_at: new Date().toISOString() })
      .eq('token', shareToken);
  }

  const shareUrl = `https://buildorder.ai/sign.html?token=${shareToken}`;

  // ── Build email ──────────────────────────────────────────────────────────
  const docSnippet = `<pre style="font-family:'Courier New',monospace;font-size:11px;line-height:1.65;white-space:pre-wrap;word-break:break-word;background:#f8f8f8;padding:20px;border-radius:8px;border:1px solid #ddd;color:#222;">${content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`;

  const contactLine = profile.phone
    ? `<a href="mailto:${profile.email}" style="color:#d97706;">${profile.email}</a> &nbsp;&middot;&nbsp; ${profile.phone}`
    : `<a href="mailto:${profile.email}" style="color:#d97706;">${profile.email}</a>`;

  const emailSubject = subject || `${bizName} sent you a ${docLabel}`;

  try {
    await resend.emails.send({
      from:     `${bizName} via BuildOrder <noreply@buildorder.ai>`,
      to:       [to_email],
      reply_to: profile.email || undefined,
      subject:  emailSubject,
      html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;max-width:650px;margin:40px auto;color:#222;padding:0 16px;background:#fff;">
  <div style="background:#F59E0B;border-radius:10px 10px 0 0;padding:20px 28px;">
    <h1 style="margin:0;font-size:20px;color:#090E1A;font-weight:900;">${bizName}</h1>
    ${profile.license_number ? `<p style="margin:4px 0 0;font-size:12px;color:rgba(9,14,26,0.65);">License #${profile.license_number}</p>` : ''}
  </div>
  <div style="background:#f9f9f9;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:28px;">
    <h2 style="margin:0 0 8px;font-size:18px;font-weight:800;color:#111;">${docLabel}</h2>
    <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#444;">
      Hi${to_name ? ' ' + to_name : ''} &mdash; <strong>${bizName}</strong> has sent you a <strong>${docLabel}</strong> for your review.
      ${document_type === 'invoice' ? 'You can view, sign, and pay securely online.' : 'Click the button below to view and sign it securely online.'}
    </p>

    <div style="text-align:center;margin:0 0 28px;">
      <a href="${shareUrl}"
         style="display:inline-block;background:#F59E0B;color:#090E1A;padding:14px 32px;border-radius:8px;font-weight:900;text-decoration:none;font-size:15px;">
        ${ctaLabel} &rarr;
      </a>
      <p style="margin:10px 0 0;font-size:12px;color:#999;">
        Or copy this link: <a href="${shareUrl}" style="color:#d97706;word-break:break-all;">${shareUrl}</a>
      </p>
    </div>

    <hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">

    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
      <tr><td style="padding:6px 0;color:#888;width:110px;">Prepared by</td><td style="padding:6px 0;font-weight:700;">${bizName}</td></tr>
      <tr><td style="padding:6px 0;color:#888;">Contact</td><td style="padding:6px 0;">${contactLine}</td></tr>
    </table>

    <hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
    <p style="font-size:13px;font-weight:700;color:#555;margin-bottom:10px;">${docLabel} Detail:</p>
    ${docSnippet}

    <p style="margin:24px 0 0;font-size:11px;color:#999;">
      Sent via <a href="https://buildorder.ai" style="color:#d97706;">BuildOrder.ai</a>.
      Questions? Reply to this email or contact ${bizName} directly.
    </p>
  </div>
</body></html>`
    });
  } catch(e) {
    console.error('send-document email error:', e.message);
    return res.status(500).json({ error: 'Email delivery failed. Please try again.' });
  }

  return res.status(200).json({ success: true });
};
