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

  // ── Payment reminders ────────────────────────────────────────────────────
  var sevenDaysMs   = 7  * 24 * 60 * 60 * 1000;
  var fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

  // Find signed, unpaid invoice links that still need reminders
  var { data: pendingLinks } = await supabase
    .from('share_links')
    .select('id, token, user_id, client_name, client_email, payment_amount, payment_reminders_sent, created_at')
    .gt('payment_amount', 0)
    .is('paid_at', null)
    .not('signed_at', 'is', null)
    .lt('payment_reminders_sent', 3);

  if (pendingLinks && pendingLinks.length > 0) {
    var payUserIds = [...new Set(pendingLinks.map(function(l) { return l.user_id; }))];
    var { data: payProfiles } = await supabase
      .from('contractor_profiles')
      .select('id, email, contractor_name, business_name')
      .in('id', payUserIds);

    var payProfileMap = {};
    (payProfiles || []).forEach(function(p) { payProfileMap[p.id] = p; });

    for (var link of pendingLinks) {
      var ageMs   = now - new Date(link.created_at).getTime();
      var remCount = link.payment_reminders_sent || 0;

      var shouldSend = false;
      if      (remCount === 0 && ageMs >= threeDaysMs)    shouldSend = true;
      else if (remCount === 1 && ageMs >= sevenDaysMs)    shouldSend = true;
      else if (remCount === 2 && ageMs >= fourteenDaysMs) shouldSend = true;
      if (!shouldSend) continue;

      var payProfile = payProfileMap[link.user_id];
      if (!payProfile || !link.client_email) continue;

      var bizName    = payProfile.business_name || payProfile.contractor_name || 'Your contractor';
      var clientName = link.client_name || 'there';
      var amtStr     = '$' + Number(link.payment_amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      var payUrl     = 'https://buildorder.ai/sign.html?token=' + link.token;
      var dayLabels  = ['3 days', '1 week', '2 weeks'];
      var dayLabel   = dayLabels[remCount] || '';

      try {
        await resend.emails.send({
          from:     bizName + ' via BuildOrder <noreply@buildorder.ai>',
          to:       [link.client_email],
          reply_to: payProfile.email,
          subject:  'Friendly reminder: invoice payment of ' + amtStr + ' is outstanding',
          html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:40px auto;color:#222;padding:0 16px;">
  <div style="background:#F59E0B;border-radius:10px 10px 0 0;padding:24px 32px;">
    <h1 style="margin:0;font-size:22px;color:#090E1A;font-weight:900;">${bizName}</h1>
  </div>
  <div style="background:#f9f9f9;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:32px;">
    <h2 style="margin:0 0 8px;font-size:18px;">Invoice payment reminder</h2>
    <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 24px;">
      Hi ${clientName}, this is a friendly reminder that your invoice of <strong>${amtStr}</strong>
      from <strong>${bizName}</strong> is still outstanding (${dayLabel} ago).
      You can pay securely by card at the link below.
    </p>
    <a href="${payUrl}"
       style="display:inline-block;background:#F59E0B;color:#090E1A;text-decoration:none;font-weight:900;padding:14px 32px;border-radius:8px;font-size:16px;margin-bottom:24px;">
      Pay ${amtStr} Now &rarr;
    </a>
    <p style="font-size:13px;color:#999;margin:0;">
      If you have any questions, reply to this email or contact ${bizName} directly at
      <a href="mailto:${payProfile.email}" style="color:#F59E0B;">${payProfile.email}</a>.
    </p>
    <p style="margin:24px 0 0;font-size:11px;color:#ccc;">Sent via BuildOrder.ai on behalf of ${bizName}</p>
  </div>
</body></html>`
        });

        await supabase
          .from('share_links')
          .update({ payment_reminders_sent: remCount + 1 })
          .eq('id', link.id);

        sent++;
      } catch (payErr) {
        console.error('Payment reminder failed for link', link.id, payErr.message);
        errs.push({ link_id: link.id, error: payErr.message });
      }
    }
  }

  // ── Unsigned document reminders ─────────────────────────────────────────
  // Find share_links that: were sent to a client, not yet signed, no sig reminder
  // sent yet, and are at least 3 days old. Nudge the client to sign.
  var { data: unsignedLinks } = await supabase
    .from('share_links')
    .select('id, token, user_id, document_type, client_name, client_email, sent_at, created_at, payment_amount')
    .is('signed_at', null)
    .is('sig_reminder_sent_at', null)
    .not('client_email', 'is', null);

  if (unsignedLinks && unsignedLinks.length > 0) {
    var sigUserIds = [...new Set(unsignedLinks.map(function(l) { return l.user_id; }))];
    var { data: sigProfiles } = await supabase
      .from('contractor_profiles')
      .select('id, email, contractor_name, business_name, phone')
      .in('id', sigUserIds);

    var sigProfileMap = {};
    (sigProfiles || []).forEach(function(p) { sigProfileMap[p.id] = p; });

    var TYPE_LABELS = {
      'contract':      'Home Improvement Contract',
      'estimate':      'Estimate',
      'invoice':       'Invoice',
      'proposal':      'Proposal & Contract',
      'change-order':  'Change Order',
      'subcontractor': 'Subcontractor Agreement',
      'lien-waiver':   'Lien Waiver',
      'takeoff':       'Material Takeoff',
      'document':      'Document'
    };

    for (var ulink of unsignedLinks) {
      // Only remind if at least 3 days have passed since sent/created
      var refDate = ulink.sent_at || ulink.created_at;
      if (!refDate) continue;
      var ageMs = now - new Date(refDate).getTime();
      if (ageMs < threeDaysMs) continue;

      // Don't remind on expired links
      if (ulink.expires_at && new Date(ulink.expires_at) < new Date()) continue;

      var sigProfile = sigProfileMap[ulink.user_id];
      if (!sigProfile || !ulink.client_email) continue;

      var docLabel   = TYPE_LABELS[ulink.document_type] || 'Document';
      var bizName    = sigProfile.business_name || sigProfile.contractor_name || 'Your contractor';
      var clientFirst = (ulink.client_name || 'there').split(' ')[0];
      var signUrl    = 'https://buildorder.ai/sign.html?token=' + ulink.token;

      try {
        // Email to client
        await resend.emails.send({
          from:     bizName + ' via BuildOrder <noreply@buildorder.ai>',
          to:       [ulink.client_email],
          reply_to: sigProfile.email,
          subject:  'Reminder: your ' + docLabel + ' is waiting for your signature',
          html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#F1F5F9;margin:0;padding:40px 16px;">
  <div style="max-width:540px;margin:0 auto;">

    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;">
      <div style="font-size:20px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        ${bizName}
      </div>
    </div>

    <div style="background:#ffffff;border-radius:0 0 14px 14px;padding:32px;border:1px solid #e5e7eb;border-top:none;">
      <h1 style="font-size:18px;font-weight:900;color:#111827;margin:0 0 10px;">
        Hey ${clientFirst} — your ${docLabel} still needs a signature.
      </h1>
      <p style="font-size:14px;color:#6B7280;line-height:1.7;margin:0 0 24px;">
        <strong style="color:#111827;">${bizName}</strong> sent you a document a few days ago
        and it looks like it's still waiting on your signature. Takes about 30 seconds.
      </p>

      <a href="${signUrl}"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:900;text-decoration:none;margin-bottom:24px;">
        Review &amp; Sign &rarr;
      </a>

      <p style="font-size:12px;color:#9CA3AF;line-height:1.7;margin:0;">
        Questions? Reply to this email or contact ${bizName}${sigProfile.phone ? ' at ' + sigProfile.phone : ''}.
        <br>Powered by <a href="https://buildorder.ai" style="color:#F59E0B;text-decoration:none;">BuildOrder.ai</a>
      </p>
    </div>
  </div>
</body></html>`
        });

        // Notify contractor too
        if (sigProfile.email) {
          await resend.emails.send({
            from:    'BuildOrder.ai <noreply@buildorder.ai>',
            to:      [sigProfile.email],
            subject: '📋 Reminder sent — ' + (ulink.client_name || ulink.client_email) + ' hasn\'t signed yet',
            html: `<div style="font-family:Inter,sans-serif;max-width:520px;margin:40px auto;padding:0 16px;">
              <div style="background:#090E1A;border-radius:12px 12px 0 0;padding:24px 28px;">
                <div style="font-size:18px;font-weight:900;color:#F8FAFC;"><span style="color:#F59E0B;">Build</span>Order</div>
              </div>
              <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:28px;">
                <h2 style="font-size:16px;font-weight:800;color:#111827;margin:0 0 8px;">Signature reminder sent</h2>
                <p style="font-size:14px;color:#6B7280;line-height:1.7;margin:0 0 16px;">
                  We just sent <strong style="color:#111827;">${ulink.client_name || ulink.client_email}</strong> a reminder
                  to sign their <strong style="color:#111827;">${docLabel}</strong>. That's 3 days with no action — might be worth a call too.
                </p>
                <a href="https://buildorder.ai/dashboard.html"
                   style="display:inline-block;background:#F59E0B;color:#090E1A;padding:10px 20px;border-radius:8px;font-weight:800;text-decoration:none;font-size:14px;">
                  View Dashboard
                </a>
              </div>
            </div>`
          });
        }

        await supabase
          .from('share_links')
          .update({ sig_reminder_sent_at: new Date().toISOString() })
          .eq('id', ulink.id);

        sent++;
      } catch (sigErr) {
        console.error('Sig reminder failed for link', ulink.id, sigErr.message);
        errs.push({ link_id: ulink.id, error: sigErr.message });
      }
    }
  }

  return res.status(200).json({
    sent,
    checked: expiring.length,
    ...(errs.length > 0 && { errors: errs })
  });
};
