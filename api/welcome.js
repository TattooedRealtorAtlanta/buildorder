const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const jwt = authHeader.replace('Bearer ', '');
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  // Fetch their profile
  const { data: profile } = await db
    .from('contractor_profiles')
    .select('contractor_name, business_name, email, founding_member, pro_expires_at')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.email) {
    return res.status(400).json({ error: 'Profile or email not found' });
  }

  const firstName = (profile.contractor_name || '').split(' ')[0] || 'there';
  const bizName   = profile.business_name || profile.contractor_name || 'your business';
  const isFounder = profile.founding_member && profile.pro_expires_at && new Date(profile.pro_expires_at) > new Date();

  const founderBlock = isFounder ? `
    <div style="background:#78350F;border:1px solid #F59E0B;border-radius:10px;padding:16px 20px;margin-bottom:24px;">
      <div style="font-size:13px;font-weight:900;color:#FCD34D;margin-bottom:4px;">⚡ Founding Member — Full Pro Access</div>
      <div style="font-size:13px;color:#FEF3C7;line-height:1.6;">
        You locked in founding member pricing — 60 days free, then $19/mo. Every Pro feature is already on. No credit card needed until your trial ends.
      </div>
    </div>` : '';

  try {
    await resend.emails.send({
      from:    'BuildOrder.ai <noreply@buildorder.ai>',
      to:      profile.email,
      subject: `Welcome to BuildOrder — your profile is set up`,
      html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#F1F5F9;margin:0;padding:40px 16px;">
  <div style="max-width:560px;margin:0 auto;">

    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;">
      <div style="font-size:22px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:13px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
    </div>

    <div style="background:#ffffff;border-radius:0 0 14px 14px;padding:32px;border:1px solid #e5e7eb;border-top:none;">
      <h1 style="font-size:20px;font-weight:900;color:#111827;margin:0 0 8px;">Hey ${firstName} — you're all set.</h1>
      <p style="font-size:15px;color:#6B7280;line-height:1.7;margin:0 0 24px;">
        Your profile for <strong style="color:#111827;">${bizName}</strong> is saved. BuildOrder will put your name, license, and business info on every document you generate — automatically.
      </p>

      ${founderBlock}

      <div style="margin-bottom:24px;">
        <div style="font-size:12px;font-weight:700;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:12px;">What you can generate right now</div>
        <table style="width:100%;border-collapse:collapse;">
          ${[
            ['📄', 'Contracts &amp; Scope of Work', 'State-compliant, all 52 states'],
            ['📋', 'Estimates',                      'Itemized with labor, materials, tax'],
            ['💰', 'Invoices',                        'With eSign + payment collection'],
            ['📝', 'Change Orders',                   'Document every scope change'],
            ['🤝', 'Subcontractor Agreements',        'Binding, with insurance clauses'],
            ['⚓', 'Lien Waivers',                    'All 4 types, notary-ready'],
            ['🔨', 'Material Takeoffs',               'Quantities, waste factor, costs'],
            ['📸', 'Job Photo Logs',                  'Organize photos by project'],
          ].map(([icon, name, desc]) => `
          <tr>
            <td style="padding:8px 0;vertical-align:top;width:28px;font-size:16px;">${icon}</td>
            <td style="padding:8px 12px 8px 0;vertical-align:top;">
              <div style="font-size:13px;font-weight:700;color:#111827;">${name}</div>
              <div style="font-size:12px;color:#9CA3AF;">${desc}</div>
            </td>
          </tr>`).join('')}
        </table>
      </div>

      <a href="https://buildorder.ai/dashboard.html"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:900;text-decoration:none;margin-bottom:20px;">
        Open Dashboard &rarr;
      </a>

      <div style="background:#F9FAFB;border-radius:8px;padding:16px;font-size:13px;color:#6B7280;line-height:1.7;">
        <strong style="color:#374151;">Quick tip:</strong> Connect your Stripe account in Settings and clients can sign and pay directly from the link you send them — no phone calls, no checks.
      </div>

      <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:12px;color:#9CA3AF;line-height:1.7;">
        Questions? Reply to this email or reach us at
        <a href="mailto:support@buildorder.ai" style="color:#F59E0B;">support@buildorder.ai</a>.
        <br>BuildOrder.ai &mdash; Contractor documents in seconds.
      </div>
    </div>

  </div>
</body></html>`
    });

    // Also notify admin
    try {
      if (process.env.ADMIN_EMAIL) {
        await resend.emails.send({
          from:    'BuildOrder.ai <noreply@buildorder.ai>',
          to:      process.env.ADMIN_EMAIL,
          subject: `New BuildOrder signup — ${profile.email}`,
          html: `<p><strong>${profile.contractor_name || 'Unknown'}</strong> (${bizName}) just completed onboarding.<br>
                 Email: ${profile.email}<br>
                 Founding member: ${isFounder ? 'YES' : 'no'}</p>`
        });
      }
    } catch (adminErr) {
      console.error('Admin notification failed:', adminErr.message);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Welcome email failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
