const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  // Vercel crons use GET; also allow POST for manual triggering
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret if set (Vercel auto-generates CRON_SECRET for the project)
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const resend = new Resend(process.env.RESEND_API_KEY);

  const now = Date.now();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;

  // Load all unreminded, active estimates
  const { data: estimates, error } = await supabase
    .from('estimates')
    .select('*')
    .is('reminder_sent_at', null)
    .in('status', ['draft', 'sent']);

  if (error) {
    console.error('cron-expiry: DB error', error);
    return res.status(500).json({ error: error.message });
  }

  // Filter to ones expiring within the next 3 days
  const expiring = (estimates || []).filter(function(est) {
    var validDays = Number(est.valid_days || 30);
    var expiresAt = new Date(est.created_at).getTime() + validDays * 24 * 60 * 60 * 1000;
    return expiresAt >= now && expiresAt <= now + threeDaysMs;
  });

  if (expiring.length === 0) {
    return res.status(200).json({ sent: 0, message: 'No estimates expiring in the next 3 days' });
  }

  // Load profiles for all affected contractors
  var userIds = [...new Set(expiring.map(function(e) { return e.user_id; }))];
  var { data: profiles } = await supabase
    .from('contractor_profiles')
    .select('id, contractor_name, business_name, email, phone')
    .in('id', userIds);

  var profileMap = {};
  (profiles || []).forEach(function(p) { profileMap[p.id] = p; });

  var sent = 0;
  var errs = [];

  for (var est of expiring) {
    var profile = profileMap[est.user_id];
    if (!profile || !profile.email) continue;

    var validDays = Number(est.valid_days || 30);
    var expiresAt = new Date(new Date(est.created_at).getTime() + validDays * 24 * 60 * 60 * 1000);
    var expiryStr = expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    var businessName = profile.business_name || profile.contractor_name;
    var clientName = est.homeowner_name || 'your client';
    var workType = est.work_type || 'General Contracting';
    var total = est.total ? '$' + Number(est.total).toLocaleString() : '';

    try {
      // ── Email to contractor ──────────────────────────────────────────
      await resend.emails.send({
        from: 'BuildOrder.ai <noreply@buildorder.ai>',
        to: [profile.email],
        subject: '⏰ Estimate expiring in 3 days — ' + clientName,
        html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:40px auto;color:#222;padding:0 16px;">
  <div style="background:#F59E0B;border-radius:10px 10px 0 0;padding:24px 32px;">
    <h1 style="margin:0;font-size:22px;color:#090E1A;font-weight:900;">BuildOrder.ai</h1>
  </div>
  <div style="background:#f9f9f9;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:32px;">
    <h2 style="margin:0 0 8px;font-size:18px;">Estimate expiring in 3 days</h2>
    <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Your estimate for <strong>${clientName}</strong> (${workType}${total ? ' — ' + total : ''}) expires on <strong>${expiryStr}</strong>.
      Now is the time to follow up — most clients make decisions in the final 24–48 hours.
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:14px;">
      <tr style="background:#f0f0f0;">
        <td style="padding:8px 12px;font-weight:700;">Client</td>
        <td style="padding:8px 12px;">${clientName}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;font-weight:700;background:#f9f9f9;">Work Type</td>
        <td style="padding:8px 12px;background:#f9f9f9;">${workType}</td>
      </tr>
      ${est.job_city ? `<tr style="background:#f0f0f0;"><td style="padding:8px 12px;font-weight:700;">Location</td><td style="padding:8px 12px;">${est.job_city}${est.job_state ? ', ' + est.job_state : ''}</td></tr>` : ''}
      ${total ? `<tr><td style="padding:8px 12px;font-weight:700;background:#f9f9f9;">Estimate Total</td><td style="padding:8px 12px;background:#f9f9f9;">${total}</td></tr>` : ''}
      <tr style="background:#fff3cd;">
        <td style="padding:8px 12px;font-weight:700;color:#856404;">Expires</td>
        <td style="padding:8px 12px;font-weight:700;color:#856404;">${expiryStr}</td>
      </tr>
    </table>
    <a href="https://buildorder.ai/dashboard.html" style="display:inline-block;background:#F59E0B;color:#090E1A;text-decoration:none;font-weight:900;padding:12px 28px;border-radius:8px;font-size:15px;">View Dashboard →</a>
    <p style="margin:24px 0 0;font-size:12px;color:#999;">Sent by BuildOrder.ai — Contractor Documents in Seconds</p>
  </div>
</body>
</html>`
      });

      // ── Email to client (if they have an email on file) ───────────────
      if (est.homeowner_email) {
        await resend.emails.send({
          from: businessName + ' via BuildOrder <noreply@buildorder.ai>',
          to: [est.homeowner_email],
          reply_to: profile.email,
          subject: 'Your estimate from ' + businessName + ' expires in 3 days',
          html: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:40px auto;color:#222;padding:0 16px;">
  <div style="background:#F59E0B;border-radius:10px 10px 0 0;padding:24px 32px;">
    <h1 style="margin:0;font-size:22px;color:#090E1A;font-weight:900;">${businessName}</h1>
  </div>
  <div style="background:#f9f9f9;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:32px;">
    <h2 style="margin:0 0 8px;font-size:18px;">Your estimate expires on ${expiryStr}</h2>
    <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Hi ${clientName},<br><br>
      This is a reminder that the estimate from <strong>${businessName}</strong> for
      <strong>${workType}</strong>${total ? ' (' + total + ')' : ''} expires on <strong>${expiryStr}</strong>.
      If you'd like to move forward, please reach out before the estimate expires.
    </p>
    ${profile.phone ? `<p style="font-size:15px;margin:0 0 8px;"><strong>Phone:</strong> ${profile.phone}</p>` : ''}
    <p style="font-size:15px;margin:0 0 24px;"><strong>Email:</strong> <a href="mailto:${profile.email}" style="color:#F59E0B;">${profile.email}</a></p>
    <p style="margin:24px 0 0;font-size:12px;color:#999;">Sent via BuildOrder.ai on behalf of ${businessName}</p>
  </div>
</body>
</html>`
        });
      }

      // Mark reminded so we don't send again
      await supabase
        .from('estimates')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', est.id);

      sent++;
    } catch (err) {
      console.error('cron-expiry: email failed for estimate', est.id, err.message);
      errs.push({ estimate_id: est.id, error: err.message });
    }
  }

  return res.status(200).json({
    sent,
    checked: expiring.length,
    ...(errs.length > 0 && { errors: errs })
  });
};
