const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

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

  // ── GET: public fetch by token ──────────────────────────────────────────
  if (req.method === 'GET') {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const { data, error } = await db
      .from('share_links')
      .select('id, token, document_content, document_type, client_name, client_email, client_sig, signed_at, expires_at, created_at')
      .eq('token', token)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Link not found' });

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Link expired' });
    }

    return res.status(200).json(data);
  }

  // ── POST ────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};

    // ── POST action=sign: public — no auth required ──────────────────────
    if (body.action === 'sign') {
      const { token, client_name, client_email, client_sig } = body;
      if (!token || !client_sig) return res.status(400).json({ error: 'Missing required fields' });

      // Fetch link — include user_id and document_type for notification
      const { data: link, error: fetchErr } = await db
        .from('share_links')
        .select('id, user_id, document_type, expires_at, signed_at')
        .eq('token', token)
        .single();

      if (fetchErr || !link) return res.status(404).json({ error: 'Link not found' });
      if (link.expires_at && new Date(link.expires_at) < new Date()) {
        return res.status(410).json({ error: 'Link expired' });
      }
      if (link.signed_at) return res.status(409).json({ error: 'Already signed' });

      const signedAt = new Date().toISOString();

      const { error: updateErr } = await db
        .from('share_links')
        .update({
          client_name:  client_name  || null,
          client_email: client_email || null,
          client_sig,
          signed_at: signedAt
        })
        .eq('token', token);

      if (updateErr) return res.status(500).json({ error: updateErr.message });

      // ── Send notification email to contractor ──────────────────────────
      try {
        const { data: profile } = await db
          .from('contractor_profiles')
          .select('email, contractor_name, business_name')
          .eq('id', link.user_id)
          .single();

        if (profile && profile.email) {
          const docLabel    = TYPE_LABELS[link.document_type] || 'Document';
          const signerName  = client_name || client_email || 'Your client';
          const bizName     = profile.business_name || profile.contractor_name || 'there';
          const signedTime  = new Date(signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

          await resend.emails.send({
            from:    'noreply@buildorder.ai',
            to:      profile.email,
            subject: `✓ ${signerName} signed your ${docLabel}`,
            html: `
              <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;padding:2rem;background:#090E1A;color:#F8FAFC;border-radius:12px;">
                <div style="font-size:1.4rem;font-weight:900;margin-bottom:1.5rem;">
                  <span style="color:#F59E0B;">Build</span>Order
                </div>
                <h2 style="font-size:1.1rem;font-weight:800;margin-bottom:0.5rem;color:#F8FAFC;">Document Signed &#10003;</h2>
                <p style="color:#94A3B8;margin-bottom:1.5rem;line-height:1.6;">
                  Hey ${bizName} &mdash; <strong style="color:#F8FAFC;">${signerName}</strong> just signed your <strong style="color:#F8FAFC;">${docLabel}</strong>.
                </p>
                <table style="width:100%;border-collapse:collapse;margin-bottom:1.5rem;">
                  ${client_name  ? `<tr><td style="padding:0.4rem 0;color:#94A3B8;font-size:0.85rem;">Name</td><td style="padding:0.4rem 0;font-size:0.85rem;">${client_name}</td></tr>` : ''}
                  ${client_email ? `<tr><td style="padding:0.4rem 0;color:#94A3B8;font-size:0.85rem;">Email</td><td style="padding:0.4rem 0;font-size:0.85rem;">${client_email}</td></tr>` : ''}
                  <tr><td style="padding:0.4rem 0;color:#94A3B8;font-size:0.85rem;">Signed at</td><td style="padding:0.4rem 0;font-size:0.85rem;">${signedTime}</td></tr>
                  <tr><td style="padding:0.4rem 0;color:#94A3B8;font-size:0.85rem;">Document</td><td style="padding:0.4rem 0;font-size:0.85rem;">${docLabel}</td></tr>
                </table>
                <a href="https://buildorder.ai/dashboard.html"
                   style="display:inline-block;background:#F59E0B;color:#090E1A;padding:0.65rem 1.5rem;border-radius:8px;font-weight:800;text-decoration:none;font-size:0.9rem;">
                  View Dashboard
                </a>
                <p style="margin-top:2rem;font-size:0.75rem;color:#475569;">
                  You received this because a client signed a document you shared via BuildOrder.ai
                </p>
              </div>
            `
          });
        }
      } catch(e) {
        // Don't fail the sign request if the notification email fails
        console.error('Sign notification email failed:', e.message);
      }

      return res.status(200).json({ success: true });
    }

    // ── POST default: create share link — auth required ──────────────────
    const authHeader = req.headers.authorization || '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

    const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { document_content, document_type } = body;
    if (!document_content) return res.status(400).json({ error: 'Missing document_content' });

    const { data: link, error: insertErr } = await db
      .from('share_links')
      .insert({
        user_id: user.id,
        document_content,
        document_type: document_type || 'document'
      })
      .select('token')
      .single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    const shareUrl = `https://buildorder.ai/sign.html?token=${link.token}`;
    return res.status(200).json({ url: shareUrl, token: link.token });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
