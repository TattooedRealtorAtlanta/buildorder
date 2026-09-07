const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── GET: public spot count ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { count, error } = await db
      .from('contractor_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('founding_member', true);

    const taken = error ? 0 : (count || 0);
    return res.status(200).json({
      count:      taken,
      limit:      50,
      spots_left: Math.max(0, 50 - taken),
      full:       taken >= 50
    });
  }

  // ── POST: grant founding member status ────────────────────────────────────
  if (req.method === 'POST') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    // Check cap
    const { count } = await db
      .from('contractor_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('founding_member', true);

    if (count !== null && count >= 50) {
      return res.status(409).json({
        error:   'founding_member_full',
        message: 'All 50 founding member spots have been claimed.'
      });
    }

    // Check if already a founding member
    const { data: existing } = await db
      .from('contractor_profiles')
      .select('founding_member, pro_expires_at')
      .eq('id', user.id)
      .single();

    if (existing && existing.founding_member && existing.pro_expires_at && new Date(existing.pro_expires_at) > new Date()) {
      return res.status(200).json({ success: true, already_active: true, expires_at: existing.pro_expires_at });
    }

    // Grant — 60 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 60);

    const { error: updateErr } = await db
      .from('contractor_profiles')
      .update({
        founding_member: true,
        pro_expires_at:  expiresAt.toISOString(),
        plan:            'pro'
      })
      .eq('id', user.id);

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    // Send confirmation email — non-critical, never block the response
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const toEmail = user.email;

      const { data: profile } = await db
        .from('contractor_profiles')
        .select('contractor_name, business_name')
        .eq('id', user.id)
        .single();

      const rawName = (profile && (profile.contractor_name || profile.business_name)) ||
        toEmail.split('@')[0].replace(/[._+-]/g, ' ').trim().split(' ')[0];
      const greeting = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
      const expiresStr = expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

      await resend.emails.send({
        from:    'BuildOrder <support@buildorder.ai>',
        to:      toEmail,
        subject: "You're in — 60 days of BuildOrder Pro starts now",
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#0F172A;margin:0;padding:40px 16px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;border:1px solid rgba(245,158,11,0.2);border-bottom:none;">
      <div style="font-size:24px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:13px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
      <div style="font-size:12px;color:#475569;margin-top:4px;font-weight:500;text-transform:uppercase;letter-spacing:0.06em;">Founding Member Access Confirmed</div>
    </div>
    <div style="background:#111827;border-radius:0 0 14px 14px;padding:32px;border:1px solid rgba(245,158,11,0.2);border-top:none;">
      <h1 style="font-size:22px;font-weight:900;color:#F8FAFC;margin:0 0 10px;letter-spacing:-0.02em;">
        ${greeting}, you're a founding member.
      </h1>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 24px;">
        Your 60 days of full Pro access is active. No credit card required — this is our thanks for being here early.
      </p>

      <div style="background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:18px 20px;margin-bottom:24px;">
        <div style="font-size:12px;font-weight:700;color:#F59E0B;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px;">Your Pro Access</div>
        <div style="font-size:14px;color:#D4A017;line-height:1.8;">
          ✓ Unlimited documents — all 8 types<br>
          ✓ PDF export<br>
          ✓ Email documents directly to clients<br>
          ✓ E-signature with full audit trail<br>
          ✓ State compliance checks — all 50 states, plus DC<br>
          ✓ Bilingual (English + Spanish)
        </div>
        <div style="margin-top:12px;font-size:13px;color:#64748B;">
          Access expires <strong style="color:#94A3B8;">${expiresStr}</strong>
        </div>
      </div>

      <a href="https://buildorder.ai/dashboard.html"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:900;text-decoration:none;margin-bottom:24px;letter-spacing:-0.01em;">
        Go to Your Dashboard &rarr;
      </a>

      <div style="background:#1A2438;border-radius:8px;padding:14px 16px;font-size:13px;color:#475569;line-height:1.7;margin-bottom:24px;">
        <strong style="color:#64748B;">Pro tip:</strong> Connect your Stripe account in Settings — your clients can sign and pay directly from the link you send them. No phone tag, no chasing checks.
      </div>

      <div style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#334155;line-height:1.7;">
        Questions? Reply to this email or reach us at
        <a href="mailto:support@buildorder.ai" style="color:#F59E0B;text-decoration:none;">support@buildorder.ai</a>.
        <br>BuildOrder.ai &mdash; Contractor documents in seconds.
      </div>
    </div>
  </div>
</body></html>`
      });
    } catch (emailErr) {
      console.error('[founding-member] confirmation email failed:', emailErr.message);
    }

    return res.status(200).json({ success: true, expires_at: expiresAt.toISOString() });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
