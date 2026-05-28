const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const crypto = require('crypto');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET ?token=TOKEN — public, no auth required ─────────────────────────
  // Returns contractor info + all share_links for this client/contractor pair
  if (req.method === 'GET') {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    // Validate the portal token
    const { data: pt, error: ptErr } = await db
      .from('portal_tokens')
      .select('contractor_user_id, client_email, client_name, expires_at')
      .eq('token', token)
      .single();

    if (ptErr || !pt) return res.status(404).json({ error: 'Portal link not found' });
    if (new Date(pt.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This portal link has expired. Ask your contractor for a new one.' });
    }

    // Fetch contractor profile
    const { data: profile } = await db
      .from('contractor_profiles')
      .select('contractor_name, business_name, phone, email, address, city, state, zip, license_number')
      .eq('id', pt.contractor_user_id)
      .single();

    // Fetch all share_links for this client + contractor
    const { data: links } = await db
      .from('share_links')
      .select('token, document_type, client_name, created_at, signed_at, paid_at, payment_amount, viewed_at, expires_at, reference_id')
      .eq('user_id', pt.contractor_user_id)
      .eq('client_email', pt.client_email)
      .order('created_at', { ascending: false });

    return res.status(200).json({
      client_name:  pt.client_name,
      client_email: pt.client_email,
      contractor:   profile || {},
      documents:    links || []
    });
  }

  // ── POST — auth required — generate portal token and email the client ───
  if (req.method === 'POST') {
    const authHeader = req.headers.authorization || '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

    const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { client_id } = req.body || {};
    if (!client_id) return res.status(400).json({ error: 'Missing client_id' });

    // Fetch the client record to get email + name
    const { data: client, error: clientErr } = await db
      .from('clients')
      .select('id, name, email')
      .eq('id', client_id)
      .eq('user_id', user.id)
      .single();

    if (clientErr || !client) return res.status(404).json({ error: 'Client not found' });
    if (!client.email) return res.status(400).json({ error: 'This client has no email address. Add one first.' });

    // Fetch contractor profile for email branding
    const { data: profile } = await db
      .from('contractor_profiles')
      .select('contractor_name, business_name, email, phone')
      .eq('id', user.id)
      .single();

    // Upsert a portal token for this contractor+client_email combo
    // (reuse existing if still valid, otherwise create fresh)
    const { data: existing } = await db
      .from('portal_tokens')
      .select('token, expires_at')
      .eq('contractor_user_id', user.id)
      .eq('client_email', client.email)
      .single();

    let portalToken;

    if (existing && new Date(existing.expires_at) > new Date()) {
      portalToken = existing.token;
    } else {
      // Generate new token
      portalToken = crypto.randomBytes(24).toString('hex');
      const { error: insertErr } = await db
        .from('portal_tokens')
        .upsert({
          token:               portalToken,
          contractor_user_id:  user.id,
          client_email:        client.email,
          client_name:         client.name || null,
          expires_at:          new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
        });

      if (insertErr) {
        console.error('Portal token insert failed:', insertErr.message);
        return res.status(500).json({ error: 'Failed to create portal token' });
      }
    }

    const portalUrl  = `https://buildorder.ai/portal.html?token=${portalToken}`;
    const bizName    = profile?.business_name || profile?.contractor_name || 'Your contractor';
    const firstName  = (client.name || 'there').split(' ')[0];

    // Send the portal email to the client
    try {
      await resend.emails.send({
        from:    'BuildOrder.ai <noreply@buildorder.ai>',
        to:      client.email,
        subject: `${bizName} shared your document portal`,
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#F1F5F9;margin:0;padding:40px 16px;">
  <div style="max-width:540px;margin:0 auto;">

    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;">
      <div style="font-size:20px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:12px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
    </div>

    <div style="background:#ffffff;border-radius:0 0 14px 14px;padding:32px;border:1px solid #e5e7eb;border-top:none;">
      <h1 style="font-size:19px;font-weight:900;color:#111827;margin:0 0 10px;">Hey ${firstName} — your document portal is ready.</h1>
      <p style="font-size:14px;color:#6B7280;line-height:1.7;margin:0 0 24px;">
        <strong style="color:#111827;">${bizName}</strong> has set up a portal where you can view, sign, and track all your project documents in one place.
      </p>

      <a href="${portalUrl}"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:900;text-decoration:none;margin-bottom:24px;">
        Open My Document Portal &rarr;
      </a>

      <div style="background:#F9FAFB;border-radius:8px;padding:14px 16px;font-size:13px;color:#6B7280;line-height:1.7;margin-bottom:20px;">
        <strong style="color:#374151;">What you'll find there:</strong> contracts, estimates, invoices, change orders, and any other documents your contractor has shared with you. You can sign and pay directly from the portal.
      </div>

      <p style="font-size:12px;color:#9CA3AF;line-height:1.7;margin:0;">
        This portal link is private — don't share it. If you have questions, contact ${bizName}${profile?.phone ? ' at ' + profile.phone : ''}.
        <br>Powered by <a href="https://buildorder.ai" style="color:#F59E0B;text-decoration:none;">BuildOrder.ai</a>
      </p>
    </div>
  </div>
</body></html>`
      });
    } catch (emailErr) {
      console.error('Portal email failed:', emailErr.message);
      // Still return the URL so the contractor can copy/share manually
      return res.status(200).json({
        success: true,
        portal_url: portalUrl,
        email_sent: false,
        warning: 'Email could not be sent — share the link manually.'
      });
    }

    return res.status(200).json({ success: true, portal_url: portalUrl, email_sent: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
