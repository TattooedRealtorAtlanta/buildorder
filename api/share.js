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
      .select('id, token, document_content, document_type, client_name, client_email, client_sig, signed_at, expires_at, created_at, user_id, viewed_at, reference_id, payment_amount, paid_at')
      .eq('token', token)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Link not found' });

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Link expired' });
    }

    // ── Determine if card payment is available ────────────────────────────
    let payment_available = false;
    if (data.payment_amount && Number(data.payment_amount) > 0) {
      const { data: prof } = await db
        .from('contractor_profiles')
        .select('stripe_account_id')
        .eq('id', data.user_id)
        .single();
      payment_available = !!(prof && prof.stripe_account_id);
    }

    // ── Fire "client viewed" notification on first open ──────────────────
    if (!data.viewed_at) {
      // Mark viewed (fire-and-forget — don't await before returning doc)
      db.from('share_links').update({ viewed_at: new Date().toISOString() }).eq('token', token).then(() => {});

      // Send notification email to contractor (async, non-blocking)
      try {
        const { data: profile } = await db
          .from('contractor_profiles')
          .select('email, contractor_name, business_name')
          .eq('id', data.user_id)
          .single();

        if (profile && profile.email) {
          const docLabel   = TYPE_LABELS[data.document_type] || 'Document';
          const bizName    = profile.business_name || profile.contractor_name || 'there';
          const viewedTime = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

          await resend.emails.send({
            from:    'noreply@buildorder.ai',
            to:      profile.email,
            subject: `👁 Your ${docLabel} was just opened`,
            html: `
              <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;padding:2rem;background:#090E1A;color:#F8FAFC;border-radius:12px;">
                <div style="font-size:1.4rem;font-weight:900;margin-bottom:1.5rem;">
                  <span style="color:#F59E0B;">Build</span>Order
                </div>
                <h2 style="font-size:1.1rem;font-weight:800;margin-bottom:0.5rem;color:#F8FAFC;">Document Opened</h2>
                <p style="color:#94A3B8;margin-bottom:1.5rem;line-height:1.6;">
                  Hey ${bizName} &mdash; someone just opened your <strong style="color:#F8FAFC;">${docLabel}</strong>. Now's a good time to follow up.
                </p>
                <table style="width:100%;border-collapse:collapse;margin-bottom:1.5rem;">
                  <tr><td style="padding:0.4rem 0;color:#94A3B8;font-size:0.85rem;">Document</td><td style="padding:0.4rem 0;font-size:0.85rem;">${docLabel}</td></tr>
                  <tr><td style="padding:0.4rem 0;color:#94A3B8;font-size:0.85rem;">Opened at</td><td style="padding:0.4rem 0;font-size:0.85rem;">${viewedTime}</td></tr>
                </table>
                <a href="https://buildorder.ai/dashboard.html"
                   style="display:inline-block;background:#F59E0B;color:#090E1A;padding:0.65rem 1.5rem;border-radius:8px;font-weight:800;text-decoration:none;font-size:0.9rem;">
                  View Dashboard
                </a>
                <p style="margin-top:2rem;font-size:0.75rem;color:#475569;">
                  If this was you testing your own link, ignore this. You'll only get this once per share link.
                </p>
              </div>
            `
          });
        }
      } catch(e) {
        console.error('View notification email failed:', e.message);
      }
    }

    return res.status(200).json({ ...data, payment_available });
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

      // ── Send confirmation copy to client ──────────────────────────────
      if (client_email) {
        try {
          const { data: profile2 } = await db
            .from('contractor_profiles')
            .select('email, contractor_name, business_name, phone')
            .eq('id', link.user_id)
            .single();

          if (profile2) {
            const docLabel2   = TYPE_LABELS[link.document_type] || 'Document';
            const bizName2    = profile2.business_name || profile2.contractor_name || 'Your contractor';
            const signedTime2 = new Date(signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

            // Re-fetch document content for the copy
            const { data: linkFull } = await db
              .from('share_links')
              .select('document_content')
              .eq('token', token)
              .single();

            const docSnippet = linkFull && linkFull.document_content
              ? `<pre style="font-family:'Courier New',monospace;font-size:11px;line-height:1.65;white-space:pre-wrap;word-break:break-word;background:#f8f8f8;padding:20px;border-radius:8px;border:1px solid #ddd;color:#222;">${linkFull.document_content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`
              : '';

            await resend.emails.send({
              from:     `${bizName2} via BuildOrder <noreply@buildorder.ai>`,
              to:       [client_email],
              reply_to: profile2.email,
              subject:  `Your signed ${docLabel2} — copy for your records`,
              html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:650px;margin:40px auto;color:#222;padding:0 16px;">
  <div style="background:#F59E0B;border-radius:10px 10px 0 0;padding:20px 28px;">
    <h1 style="margin:0;font-size:20px;color:#090E1A;font-weight:900;">${bizName2}</h1>
  </div>
  <div style="background:#f9f9f9;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:28px;">
    <div style="background:#e8f9f0;border:1px solid #6ee7b7;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:14px;font-weight:700;color:#065f46;">
      &#10003; You have signed this document
    </div>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#444;">
      Hi${client_name ? ' ' + client_name : ''}, this is your copy of the <strong>${docLabel2}</strong> you signed electronically on <strong>${signedTime2}</strong>.
      Keep this email for your records.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
      <tr style="background:#f0f0f0;"><td style="padding:8px 10px;font-weight:700;">Document</td><td style="padding:8px 10px;">${docLabel2}</td></tr>
      ${client_name ? `<tr><td style="padding:8px 10px;font-weight:700;background:#f9f9f9;">Signed by</td><td style="padding:8px 10px;background:#f9f9f9;">${client_name}</td></tr>` : ''}
      <tr style="background:#f0f0f0;"><td style="padding:8px 10px;font-weight:700;">Date &amp; Time</td><td style="padding:8px 10px;">${signedTime2}</td></tr>
      <tr><td style="padding:8px 10px;font-weight:700;background:#f9f9f9;">Prepared by</td><td style="padding:8px 10px;background:#f9f9f9;">${bizName2}</td></tr>
      ${profile2.phone ? `<tr style="background:#f0f0f0;"><td style="padding:8px 10px;font-weight:700;">Contact</td><td style="padding:8px 10px;"><a href="mailto:${profile2.email}" style="color:#d97706;">${profile2.email}</a> &nbsp;·&nbsp; ${profile2.phone}</td></tr>` : `<tr style="background:#f0f0f0;"><td style="padding:8px 10px;font-weight:700;">Contact</td><td style="padding:8px 10px;"><a href="mailto:${profile2.email}" style="color:#d97706;">${profile2.email}</a></td></tr>`}
    </table>
    <hr style="border:none;border-top:1px solid #ddd;margin:20px 0;">
    <p style="font-size:13px;font-weight:700;color:#555;margin-bottom:10px;">Signed Document:</p>
    ${docSnippet}
    <p style="margin:20px 0 0;font-size:11px;color:#999;">
      This electronic signature is legally binding under the U.S. Electronic Signatures in Global and National Commerce Act (E-SIGN).
      Document delivery powered by <a href="https://buildorder.ai" style="color:#d97706;">BuildOrder.ai</a>.
    </p>
  </div>
</body></html>`
            });
          }
        } catch(e) {
          console.error('Client confirmation email failed:', e.message);
        }
      }

      return res.status(200).json({ success: true });
    }

    // ── POST default: create share link — auth required ──────────────────
    const authHeader = req.headers.authorization || '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

    const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { document_content, document_type, reference_id, payment_amount } = body;
    if (!document_content) return res.status(400).json({ error: 'Missing document_content' });

    const insertPayload = {
      user_id: user.id,
      document_content,
      document_type: document_type || 'document'
    };
    if (reference_id)  insertPayload.reference_id   = reference_id;
    if (payment_amount && Number(payment_amount) > 0) insertPayload.payment_amount = Number(payment_amount);

    const { data: link, error: insertErr } = await db
      .from('share_links')
      .insert(insertPayload)
      .select('token')
      .single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    const shareUrl = `https://buildorder.ai/sign.html?token=${link.token}`;
    return res.status(200).json({ url: shareUrl, token: link.token });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
