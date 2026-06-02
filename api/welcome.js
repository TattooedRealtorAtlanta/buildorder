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

  const toEmail = user.email;
  if (!toEmail) return res.status(400).json({ error: 'No email found' });

  // Derive a first name from the email prefix as a best-effort greeting
  const rawPrefix = toEmail.split('@')[0].replace(/[._+-]/g, ' ').trim().split(' ')[0];
  const greeting = rawPrefix.charAt(0).toUpperCase() + rawPrefix.slice(1).toLowerCase();

  try {
    await resend.emails.send({
      from:    'BuildOrder.ai <noreply@buildorder.ai>',
      to:      toEmail,
      subject: 'Welcome to BuildOrder — your contractor documents are ready',
      html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#0F172A;margin:0;padding:40px 16px;">
  <div style="max-width:560px;margin:0 auto;">

    <!-- Header -->
    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;border:1px solid rgba(245,158,11,0.2);border-bottom:none;">
      <div style="font-size:24px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:13px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
      <div style="font-size:12px;color:#475569;margin-top:4px;font-weight:500;text-transform:uppercase;letter-spacing:0.06em;">Contractor Documents in Seconds</div>
    </div>

    <!-- Body -->
    <div style="background:#111827;border-radius:0 0 14px 14px;padding:32px;border:1px solid rgba(245,158,11,0.2);border-top:none;">

      <h1 style="font-size:22px;font-weight:900;color:#F8FAFC;margin:0 0 10px;letter-spacing:-0.02em;">
        Welcome, ${greeting}. You're in.
      </h1>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 28px;">
        Your BuildOrder account is created. The fastest way to generate contractor documents — estimates, contracts, invoices, lien waivers, and more — is waiting for you.
      </p>

      <!-- Step 1 — Complete profile -->
      <div style="background:#1A2438;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:18px 20px;margin-bottom:16px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="background:#F59E0B;color:#090E1A;font-size:11px;font-weight:900;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;text-align:center;line-height:22px;">1</div>
          <div>
            <div style="font-size:14px;font-weight:800;color:#F8FAFC;margin-bottom:4px;">Complete your contractor profile</div>
            <div style="font-size:13px;color:#64748B;line-height:1.6;">Add your business name, license number, and address. BuildOrder puts this on every document you generate — automatically.</div>
          </div>
        </div>
      </div>

      <!-- Step 2 — 5 free docs -->
      <div style="background:#1A2438;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:18px 20px;margin-bottom:16px;">
        <div style="display:flex;align-items:flex-start;gap:12px;">
          <div style="background:#F59E0B;color:#090E1A;font-size:11px;font-weight:900;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;text-align:center;line-height:22px;">2</div>
          <div>
            <div style="font-size:14px;font-weight:800;color:#F8FAFC;margin-bottom:4px;">Generate your first document — free</div>
            <div style="font-size:13px;color:#64748B;line-height:1.6;">Your account comes with <strong style="color:#F59E0B;">5 free documents per month</strong> — no credit card required. Estimates, contracts, invoices, change orders, lien waivers, and more.</div>
          </div>
        </div>
      </div>

      <!-- Founding member callout -->
      <div style="background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:18px 20px;margin-bottom:28px;">
        <div style="font-size:13px;font-weight:900;color:#F59E0B;margin-bottom:6px;">⚡ Founding Member Offer — Limited Time</div>
        <div style="font-size:13px;color:#D4A017;line-height:1.7;margin-bottom:10px;">
          Get <strong>60 days of full Pro access free</strong> — unlimited documents, e-signature, PDF export, and state compliance checks. No credit card required.
        </div>
        <a href="https://buildorder.ai/login.html?founding=1"
           style="display:inline-block;background:#F59E0B;color:#090E1A;padding:8px 18px;border-radius:7px;font-size:12px;font-weight:900;text-decoration:none;letter-spacing:0.01em;">
          Claim Founding Member Access &rarr;
        </a>
      </div>

      <!-- What you can generate -->
      <div style="margin-bottom:28px;">
        <div style="font-size:11px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:14px;">7 document types — all 50 states</div>
        <table style="width:100%;border-collapse:collapse;">
          ${[
            ['📄', 'Contracts',             'State-compliant scope of work, all 50 states'],
            ['📋', 'Estimates',             'Itemized with labor, materials, and tax'],
            ['💰', 'Invoices',              'eSign + payment collection built in'],
            ['📝', 'Change Orders',         'Document every scope change in writing'],
            ['🤝', 'Subcontractor Agreements', 'Binding, with insurance requirements'],
            ['⚓', 'Lien Waivers',          'All 4 types — conditional &amp; unconditional'],
            ['🔨', 'Material Takeoffs',     'Quantities, waste factor, and cost estimates'],
          ].map(([icon, name, desc]) => `
          <tr>
            <td style="padding:7px 0;vertical-align:top;width:28px;font-size:15px;">${icon}</td>
            <td style="padding:7px 10px 7px 0;vertical-align:top;border-bottom:1px solid rgba(255,255,255,0.04);">
              <div style="font-size:13px;font-weight:700;color:#E2E8F0;">${name}</div>
              <div style="font-size:12px;color:#475569;">${desc}</div>
            </td>
          </tr>`).join('')}
        </table>
      </div>

      <!-- CTA -->
      <a href="https://buildorder.ai/onboarding.html"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:900;text-decoration:none;margin-bottom:20px;letter-spacing:-0.01em;">
        Set Up Your Profile &amp; Get Started &rarr;
      </a>

      <!-- Footer tip -->
      <div style="background:#1A2438;border-radius:8px;padding:14px 16px;font-size:13px;color:#475569;line-height:1.7;margin-bottom:24px;">
        <strong style="color:#64748B;">Pro tip:</strong> Connect your Stripe account in Settings and your clients can sign and pay directly from the link you send — no phone calls, no checks.
      </div>

      <!-- Footer -->
      <div style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#334155;line-height:1.7;">
        Questions? Reply to this email or reach us at
        <a href="mailto:support@buildorder.ai" style="color:#F59E0B;text-decoration:none;">support@buildorder.ai</a>.
        <br>BuildOrder.ai &mdash; Contractor documents in seconds.
      </div>

    </div>
  </div>
</body></html>`
    });

    // Notify admin of new signup (non-critical)
    try {
      if (process.env.ADMIN_EMAIL) {
        await resend.emails.send({
          from:    'BuildOrder.ai <noreply@buildorder.ai>',
          to:      process.env.ADMIN_EMAIL,
          subject: `New BuildOrder signup — ${toEmail}`,
          html:    `<p>New account created: <strong>${toEmail}</strong></p>`
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
