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

  var sent = 0;
  var errs = [];

  // ── Estimate expiry reminders ────────────────────────────────────────────
  // Guarded, NOT an early return. Everything below this section (payment
  // reminders, signature reminders, and the founding member sequence) has to
  // run every day whether or not an estimate happens to be expiring today.
  if (expiring.length > 0) {

  // Load profiles for all affected contractors
  var userIds = [...new Set(expiring.map(function(e) { return e.user_id; }))];
  var { data: profiles } = await supabase
    .from('contractor_profiles')
    .select('id, contractor_name, business_name, email, phone')
    .in('id', userIds);

  var profileMap = {};
  (profiles || []).forEach(function(p) { profileMap[p.id] = p; });

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

  } // end estimate expiry reminders

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

  // ── Recurring invoice generation ────────────────────────────────────────
  var todayStr = new Date().toISOString().slice(0, 10);

  var { data: dueRecurring } = await supabase
    .from('invoices')
    .select('*')
    .not('recurrence', 'is', null)
    .lte('next_recur_date', todayStr);

  if (dueRecurring && dueRecurring.length > 0) {
    var recurUserIds = [...new Set(dueRecurring.map(function(i) { return i.user_id; }))];
    var { data: recurProfiles } = await supabase
      .from('contractor_profiles')
      .select('id, contractor_name, business_name, email, phone')
      .in('id', recurUserIds);

    var recurProfileMap = {};
    (recurProfiles || []).forEach(function(p) { recurProfileMap[p.id] = p; });

    for (var inv of dueRecurring) {
      try {
        // Clone invoice as a new draft
        var newInvoice = {
          user_id:         inv.user_id,
          homeowner_name:  inv.homeowner_name,
          homeowner_email: inv.homeowner_email,
          homeowner_phone: inv.homeowner_phone,
          job_address:     inv.job_address,
          job_city:        inv.job_city,
          job_state:       inv.job_state,
          work_type:       inv.work_type,
          subtotal:        inv.subtotal,
          tax_rate:        inv.tax_rate,
          tax_amount:      inv.tax_amount,
          total:           inv.total,
          deposit_paid:    0,
          balance_due:     inv.total,
          due_days:        inv.due_days,
          content:         inv.content,
          status:          'sent',
          recur_source_id: inv.recur_source_id || inv.id
        };

        var { data: created, error: createErr } = await supabase
          .from('invoices')
          .insert(newInvoice)
          .select('id, doc_number')
          .single();

        if (createErr) { console.error('Recurring invoice create failed:', createErr.message); errs.push({ source_id: inv.id, error: createErr.message }); continue; }

        // Calculate next recurrence date on the original
        function nextDate(current, interval) {
          var d = new Date(current + 'T00:00:00');
          if (interval === 'weekly')    d.setDate(d.getDate() + 7);
          else if (interval === 'biweekly')  d.setDate(d.getDate() + 14);
          else if (interval === 'monthly')   d.setMonth(d.getMonth() + 1);
          else if (interval === 'quarterly') d.setMonth(d.getMonth() + 3);
          return d.toISOString().slice(0, 10);
        }
        var newNextDate = nextDate(inv.next_recur_date || todayStr, inv.recurrence);

        await supabase.from('invoices').update({ next_recur_date: newNextDate }).eq('id', inv.id);

        // Email client
        if (inv.homeowner_email) {
          var prof = recurProfileMap[inv.user_id];
          var bizName = (prof && (prof.business_name || prof.contractor_name)) || 'Your contractor';
          var clientFirst = (inv.homeowner_name || 'there').split(' ')[0];
          var fmtTotal = '$' + Number(inv.total || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

          // Create a share_link so the client can access the invoice without a BuildOrder account
          var shareToken = null;
          try {
            var shareLinkPayload = {
              user_id:          inv.user_id,
              document_content: inv.content || '',
              document_type:    'invoice',
              reference_id:     created.id,
              client_name:      inv.homeowner_name || null,
              client_email:     inv.homeowner_email,
              sent_at:          new Date().toISOString()
            };
            if (inv.total && Number(inv.total) > 0) shareLinkPayload.payment_amount = Number(inv.total);
            var { data: sl, error: slErr } = await supabase
              .from('share_links')
              .insert(shareLinkPayload)
              .select('token')
              .single();
            if (!slErr && sl) shareToken = sl.token;
          } catch (slEx) {
            console.error('share_link create failed for recurring invoice', created.id, slEx.message);
          }

          var invoiceUrl = shareToken
            ? 'https://buildorder.ai/sign.html?token=' + shareToken
            : 'https://buildorder.ai/sign.html';

          await resend.emails.send({
            from:     bizName + ' via BuildOrder <noreply@buildorder.ai>',
            to:       [inv.homeowner_email],
            reply_to: prof && prof.email ? prof.email : undefined,
            subject:  'New invoice from ' + bizName + ' — ' + fmtTotal,
            html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#F1F5F9;margin:0;padding:40px 16px;">
  <div style="max-width:520px;margin:0 auto;">
    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;">
      <div style="font-size:20px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">${bizName}</div>
    </div>
    <div style="background:#fff;border-radius:0 0 14px 14px;padding:32px;border:1px solid #e5e7eb;border-top:none;">
      <h1 style="font-size:19px;font-weight:900;color:#111827;margin:0 0 8px;">New invoice ready, ${clientFirst}.</h1>
      <p style="font-size:14px;color:#6B7280;line-height:1.7;margin:0 0 24px;">
        <strong style="color:#111827;">${bizName}</strong> has issued your recurring invoice for
        <strong style="color:#111827;">${inv.work_type || 'services'}</strong> — <strong style="color:#111827;">${fmtTotal}</strong>.
      </p>
      <a href="${invoiceUrl}" style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:900;text-decoration:none;margin-bottom:24px;">View Invoice &rarr;</a>
      <p style="font-size:12px;color:#9CA3AF;margin:0;line-height:1.6;">
        Sent via <a href="https://buildorder.ai" style="color:#F59E0B;text-decoration:none;">BuildOrder.ai</a> on behalf of ${bizName}
      </p>
    </div>
  </div>
</body></html>`
          });
        }

        sent++;
      } catch (recurErr) {
        console.error('Recurring invoice failed for', inv.id, recurErr.message);
        errs.push({ source_id: inv.id, error: recurErr.message });
      }
    }
  }

  // ── Founding member Day 3 nudge (first document) ────────────────────────────
  // Window: pro_expires_at is 56–58 days from now (user is ~3 days in).
  var fm3After  = new Date(now + 56 * 24 * 60 * 60 * 1000).toISOString();
  var fm3Before = new Date(now + 58 * 24 * 60 * 60 * 1000).toISOString();

  var { data: warn3List } = await supabase
    .from('contractor_profiles')
    .select('id, email, contractor_name, business_name, pro_expires_at')
    .eq('founding_member', true)
    .eq('founding_warn3_sent', false)
    .gte('pro_expires_at', fm3After)
    .lte('pro_expires_at', fm3Before);

  for (var w3 of (warn3List || [])) {
    if (!w3.email) continue;
    var w3Name = w3.contractor_name || w3.business_name || w3.email.split('@')[0];
    try {
      await resend.emails.send({
        from:    'BuildOrder <support@buildorder.ai>',
        to:      w3.email,
        subject: 'Have you generated your first document yet?',
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#0F172A;margin:0;padding:40px 16px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;border:1px solid rgba(245,158,11,0.2);border-bottom:none;">
      <div style="font-size:24px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:13px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
    </div>
    <div style="background:#111827;border-radius:0 0 14px 14px;padding:32px;border:1px solid rgba(245,158,11,0.2);border-top:none;">
      <h1 style="font-size:22px;font-weight:900;color:#F8FAFC;margin:0 0 10px;letter-spacing:-0.02em;">
        ${w3Name}, have you tried it yet?
      </h1>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 24px;">
        You signed up three days ago and your Pro access is fully active. If you haven't generated your first document yet, it takes about 60 seconds. Here's where most contractors start:
      </p>

      <div style="background:#1A2438;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:18px 20px;margin-bottom:24px;">
        <div style="font-size:13px;color:#F8FAFC;font-weight:700;margin-bottom:6px;">Start with an Estimate</div>
        <div style="font-size:13px;color:#64748B;line-height:1.6;">Enter the job address, scope of work, and your line items. BuildOrder generates a professional, itemized estimate in seconds — ready to send for e-signature.</div>
      </div>

      <a href="https://buildorder.ai/new-estimate.html"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:900;text-decoration:none;margin-bottom:16px;letter-spacing:-0.01em;">
        Generate Your First Estimate &rarr;
      </a>
      <a href="https://buildorder.ai/dashboard.html"
         style="display:block;text-align:center;background:transparent;color:#94A3B8;padding:10px 24px;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none;margin-bottom:24px;border:1px solid rgba(255,255,255,0.07);">
        Go to Dashboard
      </a>

      <div style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#334155;line-height:1.7;">
        Questions? Reply to this email — we read every one.
        <br>BuildOrder.ai &mdash; Contractor documents in seconds.
      </div>
    </div>
  </div>
</body></html>`
      });
      await supabase.from('contractor_profiles')
        .update({ founding_warn3_sent: true })
        .eq('id', w3.id);
      sent++;
    } catch (e) {
      console.error('founding warn3 email failed for', w3.id, e.message);
      errs.push({ type: 'founding_warn3', user_id: w3.id, error: e.message });
    }
  }

  // ── Founding member Day 7 tips (3 use cases) ─────────────────────────────────
  // Window: pro_expires_at is 52–54 days from now (user is ~7 days in).
  var fm7After  = new Date(now + 52 * 24 * 60 * 60 * 1000).toISOString();
  var fm7Before = new Date(now + 54 * 24 * 60 * 60 * 1000).toISOString();

  var { data: warn7List } = await supabase
    .from('contractor_profiles')
    .select('id, email, contractor_name, business_name, pro_expires_at')
    .eq('founding_member', true)
    .eq('founding_warn7_sent', false)
    .gte('pro_expires_at', fm7After)
    .lte('pro_expires_at', fm7Before);

  for (var w7 of (warn7List || [])) {
    if (!w7.email) continue;
    var w7Name = w7.contractor_name || w7.business_name || w7.email.split('@')[0];
    try {
      await resend.emails.send({
        from:    'BuildOrder <support@buildorder.ai>',
        to:      w7.email,
        subject: '3 documents that protect you on every job',
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#0F172A;margin:0;padding:40px 16px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;border:1px solid rgba(245,158,11,0.2);border-bottom:none;">
      <div style="font-size:24px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:13px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
    </div>
    <div style="background:#111827;border-radius:0 0 14px 14px;padding:32px;border:1px solid rgba(245,158,11,0.2);border-top:none;">
      <h1 style="font-size:22px;font-weight:900;color:#F8FAFC;margin:0 0 10px;letter-spacing:-0.02em;">
        Most contractors only use one of these.
      </h1>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 24px;">
        Your Pro access includes all 7 document types. Here are three that don't get used enough — and all three can save you real money.
      </p>

      <div style="background:#1A2438;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:18px 20px;margin-bottom:14px;">
        <div style="font-size:13px;font-weight:800;color:#F59E0B;margin-bottom:5px;">Proposal &amp; Contract — combined</div>
        <div style="font-size:13px;color:#64748B;line-height:1.6;">One document. Scope, pricing, payment schedule, and legally binding signature all in a single send. Clients sign it, you're protected before you touch a tool.</div>
      </div>

      <div style="background:#1A2438;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:18px 20px;margin-bottom:14px;">
        <div style="font-size:13px;font-weight:800;color:#F59E0B;margin-bottom:5px;">Change Order</div>
        <div style="font-size:13px;color:#64748B;line-height:1.6;">Scope creep kills margins. Any time the job changes — added work, deleted work, price adjustment — generate a change order and get it signed. No more "I thought that was included."</div>
      </div>

      <div style="background:#1A2438;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:18px 20px;margin-bottom:24px;">
        <div style="font-size:13px;font-weight:800;color:#F59E0B;margin-bottom:5px;">Lien Waiver</div>
        <div style="font-size:13px;color:#64748B;line-height:1.6;">Required at final payment on most jobs. BuildOrder generates all four types — conditional, unconditional, partial, final — with state-specific language. Takes 30 seconds.</div>
      </div>

      <a href="https://buildorder.ai/dashboard.html"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:900;text-decoration:none;margin-bottom:24px;letter-spacing:-0.01em;">
        Try One Now &rarr;
      </a>

      <div style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#334155;line-height:1.7;">
        Questions? Reply to this email or reach us at
        <a href="mailto:support@buildorder.ai" style="color:#F59E0B;text-decoration:none;">support@buildorder.ai</a>.
        <br>BuildOrder.ai &mdash; Contractor documents in seconds.
      </div>
    </div>
  </div>
</body></html>`
      });
      await supabase.from('contractor_profiles')
        .update({ founding_warn7_sent: true })
        .eq('id', w7.id);
      sent++;
    } catch (e) {
      console.error('founding warn7 email failed for', w7.id, e.message);
      errs.push({ type: 'founding_warn7', user_id: w7.id, error: e.message });
    }
  }

  // ── Founding member Day 14 check-in ──────────────────────────────────────────
  // Window: pro_expires_at is 44–46 days from now (user is ~14 days in).
  var fm14After  = new Date(now + 44 * 24 * 60 * 60 * 1000).toISOString();
  var fm14Before = new Date(now + 46 * 24 * 60 * 60 * 1000).toISOString();

  var { data: warn14List } = await supabase
    .from('contractor_profiles')
    .select('id, email, contractor_name, business_name, pro_expires_at')
    .eq('founding_member', true)
    .eq('founding_warn14_sent', false)
    .gte('pro_expires_at', fm14After)
    .lte('pro_expires_at', fm14Before);

  for (var w14 of (warn14List || [])) {
    if (!w14.email) continue;
    var w14Name = w14.contractor_name || w14.business_name || w14.email.split('@')[0];
    try {
      await resend.emails.send({
        from:    'BuildOrder <support@buildorder.ai>',
        to:      w14.email,
        subject: 'Checking in — everything good?',
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#0F172A;margin:0;padding:40px 16px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;border:1px solid rgba(245,158,11,0.2);border-bottom:none;">
      <div style="font-size:24px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:13px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
    </div>
    <div style="background:#111827;border-radius:0 0 14px 14px;padding:32px;border:1px solid rgba(245,158,11,0.2);border-top:none;">
      <h1 style="font-size:22px;font-weight:900;color:#F8FAFC;margin:0 0 10px;letter-spacing:-0.02em;">
        ${w14Name} — just checking in.
      </h1>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 24px;">
        Two weeks in. You still have 46 days of Pro access left. If you've been busy on jobs and haven't had time to dig in, that's fine — the tool will be here when you need it.
      </p>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 28px;">
        If something felt confusing or didn't work the way you expected, reply to this email and tell us. We build this for working contractors and we take that seriously.
      </p>

      <a href="https://buildorder.ai/dashboard.html"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:900;text-decoration:none;margin-bottom:24px;letter-spacing:-0.01em;">
        Open BuildOrder &rarr;
      </a>

      <div style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#334155;line-height:1.7;">
        Reply any time — we read every email.
        <br>BuildOrder.ai &mdash; Contractor documents in seconds.
      </div>
    </div>
  </div>
</body></html>`
      });
      await supabase.from('contractor_profiles')
        .update({ founding_warn14_sent: true })
        .eq('id', w14.id);
      sent++;
    } catch (e) {
      console.error('founding warn14 email failed for', w14.id, e.message);
      errs.push({ type: 'founding_warn14', user_id: w14.id, error: e.message });
    }
  }

  // ── Founding member Day 30 halfway point ─────────────────────────────────────
  // Window: pro_expires_at is 28–32 days from now (user is ~30 days in).
  var fm30After  = new Date(now + 28 * 24 * 60 * 60 * 1000).toISOString();
  var fm30Before = new Date(now + 32 * 24 * 60 * 60 * 1000).toISOString();

  var { data: warn30List } = await supabase
    .from('contractor_profiles')
    .select('id, email, contractor_name, business_name, pro_expires_at')
    .eq('founding_member', true)
    .eq('founding_warn30_sent', false)
    .gte('pro_expires_at', fm30After)
    .lte('pro_expires_at', fm30Before);

  for (var w30 of (warn30List || [])) {
    if (!w30.email) continue;
    var w30Name    = w30.contractor_name || w30.business_name || w30.email.split('@')[0];
    var w30Expires = new Date(w30.pro_expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    try {
      await resend.emails.send({
        from:    'BuildOrder <support@buildorder.ai>',
        to:      w30.email,
        subject: 'Halfway through your founding member access',
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#0F172A;margin:0;padding:40px 16px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;border:1px solid rgba(245,158,11,0.2);border-bottom:none;">
      <div style="font-size:24px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:13px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
    </div>
    <div style="background:#111827;border-radius:0 0 14px 14px;padding:32px;border:1px solid rgba(245,158,11,0.2);border-top:none;">
      <h1 style="font-size:22px;font-weight:900;color:#F8FAFC;margin:0 0 10px;letter-spacing:-0.02em;">
        30 days in. 30 days left.
      </h1>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 24px;">
        ${w30Name}, your founding member Pro access runs until <strong style="color:#F8FAFC;">${w30Expires}</strong>. Here's a quick reminder of everything that's included while you have it.
      </p>

      <div style="background:#1A2438;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:18px 20px;margin-bottom:24px;">
        <div style="font-size:12px;font-weight:700;color:#F59E0B;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:12px;">What's included in Pro</div>
        <div style="font-size:14px;color:#94A3B8;line-height:2;">
          ✓ Unlimited documents — all 7 types, no monthly cap<br>
          ✓ PDF export and download<br>
          ✓ Email documents directly to clients<br>
          ✓ E-signature with full audit trail<br>
          ✓ State-compliant language — all 50 states<br>
          ✓ Bilingual documents (English + Spanish)<br>
          ✓ Client address book
        </div>
      </div>

      <div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:10px;padding:16px 20px;margin-bottom:24px;">
        <div style="font-size:12px;font-weight:700;color:#F59E0B;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:6px;">Coming soon</div>
        <div style="font-size:13px;color:#D4A017;line-height:1.7;">Job cost tracking, branded document headers, and team access for multi-crew operations — all landing later this year for Pro members first.</div>
      </div>

      <a href="https://buildorder.ai/pricing.html"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:900;text-decoration:none;margin-bottom:24px;letter-spacing:-0.01em;">
        Lock In Pro — $19/mo &rarr;
      </a>

      <div style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#334155;line-height:1.7;">
        Questions? Reply to this email or reach us at
        <a href="mailto:support@buildorder.ai" style="color:#F59E0B;text-decoration:none;">support@buildorder.ai</a>.
        <br>BuildOrder.ai &mdash; Contractor documents in seconds.
      </div>
    </div>
  </div>
</body></html>`
      });
      await supabase.from('contractor_profiles')
        .update({ founding_warn30_sent: true })
        .eq('id', w30.id);
      sent++;
    } catch (e) {
      console.error('founding warn30 email failed for', w30.id, e.message);
      errs.push({ type: 'founding_warn30', user_id: w30.id, error: e.message });
    }
  }

  // ── Founding member Day 55 hard urgency (5 days left) ────────────────────────
  // Window: pro_expires_at is 4–6 days from now (user is ~55 days in).
  var fm55After  = new Date(now +  4 * 24 * 60 * 60 * 1000).toISOString();
  var fm55Before = new Date(now +  6 * 24 * 60 * 60 * 1000).toISOString();

  var { data: warn55List } = await supabase
    .from('contractor_profiles')
    .select('id, email, contractor_name, business_name, pro_expires_at')
    .eq('founding_member', true)
    .eq('founding_warn55_sent', false)
    .gte('pro_expires_at', fm55After)
    .lte('pro_expires_at', fm55Before);

  for (var w55 of (warn55List || [])) {
    if (!w55.email) continue;
    var w55Name    = w55.contractor_name || w55.business_name || w55.email.split('@')[0];
    var w55Expires = new Date(w55.pro_expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    try {
      await resend.emails.send({
        from:    'BuildOrder <support@buildorder.ai>',
        to:      w55.email,
        subject: '5 days left — don\'t lose Pro access',
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#0F172A;margin:0;padding:40px 16px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;border:1px solid rgba(245,158,11,0.2);border-bottom:none;">
      <div style="font-size:24px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:13px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
    </div>
    <div style="background:#111827;border-radius:0 0 14px 14px;padding:32px;border:1px solid rgba(245,158,11,0.2);border-top:none;">
      <h1 style="font-size:22px;font-weight:900;color:#F8FAFC;margin:0 0 10px;letter-spacing:-0.02em;">
        5 days left. Don't let it lapse.
      </h1>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 24px;">
        ${w55Name}, your founding member Pro access expires on <strong style="color:#F8FAFC;">${w55Expires}</strong>. After that, you're on the free plan — 5 documents a month, no PDF export, no email delivery, no e-signature.
      </p>

      <div style="background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:18px 20px;margin-bottom:24px;">
        <div style="font-size:13px;color:#D4A017;line-height:1.8;">
          Keep access to everything:<br>
          ✓ Unlimited documents<br>
          ✓ PDF export<br>
          ✓ Email to clients<br>
          ✓ E-signature + audit trail<br>
          ✓ All 50 states compliant<br><br>
          <strong>$19/month. Cancel any time.</strong>
        </div>
      </div>

      <a href="https://buildorder.ai/pricing.html"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:900;text-decoration:none;margin-bottom:24px;letter-spacing:-0.01em;">
        Upgrade Now — Keep Pro Access &rarr;
      </a>

      <div style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#334155;line-height:1.7;">
        Questions? Reply to this email or reach us at
        <a href="mailto:support@buildorder.ai" style="color:#F59E0B;text-decoration:none;">support@buildorder.ai</a>.
        <br>BuildOrder.ai &mdash; Contractor documents in seconds.
      </div>
    </div>
  </div>
</body></html>`
      });
      await supabase.from('contractor_profiles')
        .update({ founding_warn55_sent: true })
        .eq('id', w55.id);
      sent++;
    } catch (e) {
      console.error('founding warn55 email failed for', w55.id, e.message);
      errs.push({ type: 'founding_warn55', user_id: w55.id, error: e.message });
    }
  }

  // ── Founding member Day 45 warning (15 days remaining) ─────────────────────
  // Window: pro_expires_at is 14–16 days from now. Flag prevents resends.
  var fm45After  = new Date(now + 14 * 24 * 60 * 60 * 1000).toISOString();
  var fm45Before = new Date(now + 16 * 24 * 60 * 60 * 1000).toISOString();

  var { data: warn45List } = await supabase
    .from('contractor_profiles')
    .select('id, email, contractor_name, business_name, pro_expires_at')
    .eq('founding_member', true)
    .eq('founding_warn45_sent', false)
    .gte('pro_expires_at', fm45After)
    .lte('pro_expires_at', fm45Before);

  for (var w45 of (warn45List || [])) {
    if (!w45.email) continue;
    var w45Name    = w45.contractor_name || w45.business_name || w45.email.split('@')[0];
    var w45Expires = new Date(w45.pro_expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    try {
      await resend.emails.send({
        from:    'BuildOrder <support@buildorder.ai>',
        to:      w45.email,
        subject: '15 days left on your BuildOrder Pro access',
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#0F172A;margin:0;padding:40px 16px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;border:1px solid rgba(245,158,11,0.2);border-bottom:none;">
      <div style="font-size:24px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:13px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
    </div>
    <div style="background:#111827;border-radius:0 0 14px 14px;padding:32px;border:1px solid rgba(245,158,11,0.2);border-top:none;">
      <h1 style="font-size:22px;font-weight:900;color:#F8FAFC;margin:0 0 10px;letter-spacing:-0.02em;">
        ${w45Name} — 15 days left on Pro.
      </h1>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 24px;">
        Your founding member Pro access expires on <strong style="color:#F8FAFC;">${w45Expires}</strong>. After that, your account moves to the free plan (5 documents/month).
      </p>

      <div style="background:#1A2438;border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:18px 20px;margin-bottom:24px;">
        <div style="font-size:12px;font-weight:700;color:#F59E0B;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px;">What you keep with Pro — $19/mo</div>
        <div style="font-size:14px;color:#94A3B8;line-height:1.8;">
          ✓ Unlimited documents — no monthly cap<br>
          ✓ PDF export<br>
          ✓ Email documents directly to clients<br>
          ✓ E-signature with full audit trail<br>
          ✓ State compliance checks — all 50 states<br>
          ✓ Bilingual (English + Spanish)
        </div>
      </div>

      <a href="https://buildorder.ai/pricing.html"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:900;text-decoration:none;margin-bottom:24px;letter-spacing:-0.01em;">
        Keep Pro — $19/mo &rarr;
      </a>

      <div style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#334155;line-height:1.7;">
        Questions? Reply to this email or reach us at
        <a href="mailto:support@buildorder.ai" style="color:#F59E0B;text-decoration:none;">support@buildorder.ai</a>.
        <br>BuildOrder.ai &mdash; Contractor documents in seconds.
      </div>
    </div>
  </div>
</body></html>`
      });
      await supabase.from('contractor_profiles')
        .update({ founding_warn45_sent: true })
        .eq('id', w45.id);
      sent++;
    } catch (e) {
      console.error('founding warn45 email failed for', w45.id, e.message);
      errs.push({ type: 'founding_warn45', user_id: w45.id, error: e.message });
    }
  }

  // ── Founding member Day 60 expiry notice (expires tomorrow) ─────────────────
  // Window: pro_expires_at is 0–2 days from now. Flag prevents resends.
  var fm60Before = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString();

  var { data: warn60List } = await supabase
    .from('contractor_profiles')
    .select('id, email, contractor_name, business_name, pro_expires_at')
    .eq('founding_member', true)
    .eq('founding_warn60_sent', false)
    .gt('pro_expires_at', new Date(now).toISOString())
    .lte('pro_expires_at', fm60Before);

  for (var w60 of (warn60List || [])) {
    if (!w60.email) continue;
    var w60Name    = w60.contractor_name || w60.business_name || w60.email.split('@')[0];
    var w60Expires = new Date(w60.pro_expires_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    try {
      await resend.emails.send({
        from:    'BuildOrder <support@buildorder.ai>',
        to:      w60.email,
        subject: 'Your BuildOrder Pro access expires tomorrow',
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#0F172A;margin:0;padding:40px 16px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;border:1px solid rgba(245,158,11,0.2);border-bottom:none;">
      <div style="font-size:24px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:13px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
    </div>
    <div style="background:#111827;border-radius:0 0 14px 14px;padding:32px;border:1px solid rgba(245,158,11,0.2);border-top:none;">
      <h1 style="font-size:22px;font-weight:900;color:#F8FAFC;margin:0 0 10px;letter-spacing:-0.02em;">
        Pro access expires tomorrow.
      </h1>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 24px;">
        ${w60Name}, your founding member Pro access expires on <strong style="color:#F8FAFC;">${w60Expires}</strong>. Upgrade today to keep your current workflow — unlimited documents, PDF export, email delivery, and e-signature.
      </p>

      <div style="background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:18px 20px;margin-bottom:24px;">
        <div style="font-size:13px;color:#D4A017;line-height:1.8;">
          After expiry your account drops to the <strong>free plan</strong>:<br>
          &nbsp;✗ 5 documents/month (no more unlimited)<br>
          &nbsp;✗ No PDF export<br>
          &nbsp;✗ No email to clients<br>
          &nbsp;✗ No e-signature
        </div>
      </div>

      <a href="https://buildorder.ai/pricing.html"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:900;text-decoration:none;margin-bottom:24px;letter-spacing:-0.01em;">
        Upgrade to Pro — $19/mo &rarr;
      </a>

      <div style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#334155;line-height:1.7;">
        Questions? Reply to this email or reach us at
        <a href="mailto:support@buildorder.ai" style="color:#F59E0B;text-decoration:none;">support@buildorder.ai</a>.
        <br>BuildOrder.ai &mdash; Contractor documents in seconds.
      </div>
    </div>
  </div>
</body></html>`
      });
      await supabase.from('contractor_profiles')
        .update({ founding_warn60_sent: true })
        .eq('id', w60.id);
      sent++;
    } catch (e) {
      console.error('founding warn60 email failed for', w60.id, e.message);
      errs.push({ type: 'founding_warn60', user_id: w60.id, error: e.message });
    }
  }


  // ── Founding member Day +1 lapsed (access ended yesterday) ───────────────────
  // Window: pro_expires_at is 0–2 days in the PAST. Flag prevents resends.
  var fmL1After = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();

  var { data: lapsed1List } = await supabase
    .from('contractor_profiles')
    .select('id, email, contractor_name, business_name, pro_expires_at')
    .eq('founding_member', true)
    .eq('founding_lapsed1_sent', false)
    .gte('pro_expires_at', fmL1After)
    .lte('pro_expires_at', new Date(now).toISOString());

  for (var l1 of (lapsed1List || [])) {
    if (!l1.email) continue;
    var l1Name = l1.contractor_name || l1.business_name || l1.email.split('@')[0];
    try {
      await resend.emails.send({
        from:    'BuildOrder <support@buildorder.ai>',
        to:      l1.email,
        subject: 'Your Pro access ended',
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#0F172A;margin:0;padding:40px 16px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;border:1px solid rgba(245,158,11,0.2);border-bottom:none;">
      <div style="font-size:24px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:13px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
    </div>
    <div style="background:#111827;border-radius:0 0 14px 14px;padding:32px;border:1px solid rgba(245,158,11,0.2);border-top:none;">
      <h1 style="font-size:22px;font-weight:900;color:#F8FAFC;margin:0 0 10px;letter-spacing:-0.02em;">
        Your founding member access ended.
      </h1>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 24px;">
        ${l1Name}, your 60 days of Pro are up. Your account is still here and nothing was deleted &mdash; it just dropped to the free plan.
      </p>

      <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.25);border-radius:10px;padding:18px 20px;margin-bottom:14px;">
        <div style="font-size:12px;font-weight:800;color:#F87171;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px;">What you lost</div>
        <div style="font-size:13px;color:#94A3B8;line-height:1.8;">
          &nbsp;&times; Unlimited documents &mdash; now capped at 5/month<br>
          &nbsp;&times; PDF export<br>
          &nbsp;&times; Email delivery to clients<br>
          &nbsp;&times; E-signature and payment links
        </div>
      </div>

      <div style="background:rgba(52,211,153,0.06);border:1px solid rgba(52,211,153,0.22);border-radius:10px;padding:18px 20px;margin-bottom:24px;">
        <div style="font-size:12px;font-weight:800;color:#34D399;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:10px;">What you keep</div>
        <div style="font-size:13px;color:#94A3B8;line-height:1.8;">
          &nbsp;&check; Every document you already generated<br>
          &nbsp;&check; All 8 document types<br>
          &nbsp;&check; All 50 states, plus DC and Puerto Rico<br>
          &nbsp;&check; 5 documents per month, free, for as long as you want
        </div>
      </div>

      <a href="https://buildorder.ai/pricing.html"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:900;text-decoration:none;margin-bottom:24px;letter-spacing:-0.01em;">
        Turn Pro back on &mdash; $19/mo &rarr;
      </a>

      <div style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#334155;line-height:1.7;">
        If BuildOrder wasn't a fit, just reply and tell me why &mdash; I read every one.
        <br>BuildOrder.ai &mdash; Contractor documents in seconds.
      </div>
    </div>
  </div>
</body></html>`
      });
      await supabase.from('contractor_profiles')
        .update({ founding_lapsed1_sent: true })
        .eq('id', l1.id);
      sent++;
    } catch (e) {
      console.error('founding lapsed1 email failed for', l1.id, e.message);
      errs.push({ type: 'founding_lapsed1', user_id: l1.id, error: e.message });
    }
  }

  // ── Founding member Day +7 lapsed (one week on free) ─────────────────────────
  // Window: pro_expires_at is 6–8 days in the PAST.
  var fmL7After  = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
  var fmL7Before = new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString();

  var { data: lapsed7List } = await supabase
    .from('contractor_profiles')
    .select('id, email, contractor_name, business_name')
    .eq('founding_member', true)
    .eq('founding_lapsed7_sent', false)
    .gte('pro_expires_at', fmL7After)
    .lte('pro_expires_at', fmL7Before);

  for (var l7 of (lapsed7List || [])) {
    if (!l7.email) continue;
    var l7Name = l7.contractor_name || l7.business_name || l7.email.split('@')[0];
    try {
      await resend.emails.send({
        from:    'BuildOrder <support@buildorder.ai>',
        to:      l7.email,
        subject: 'The one thing the free plan can\'t do',
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#0F172A;margin:0;padding:40px 16px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;border:1px solid rgba(245,158,11,0.2);border-bottom:none;">
      <div style="font-size:24px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:13px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
    </div>
    <div style="background:#111827;border-radius:0 0 14px 14px;padding:32px;border:1px solid rgba(245,158,11,0.2);border-top:none;">
      <h1 style="font-size:22px;font-weight:900;color:#F8FAFC;margin:0 0 10px;letter-spacing:-0.02em;">
        Getting paid is the part that's gated.
      </h1>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 20px;">
        ${l7Name}, you've been on the free plan for a week. You can still write documents &mdash; that part works fine.
      </p>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 24px;">
        What you can't do is send one link that lets a homeowner read the scope, sign it, and pay the deposit from their phone. That's the piece that turns a signed estimate into money in your account the same day, and it's Pro only.
      </p>

      <div style="background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.3);border-radius:10px;padding:18px 20px;margin-bottom:24px;">
        <div style="font-size:13px;color:#D4A017;line-height:1.8;">
          One job where the deposit lands a week earlier pays for a year of Pro.
        </div>
      </div>

      <a href="https://buildorder.ai/pricing.html"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:16px 24px;border-radius:10px;font-size:16px;font-weight:900;text-decoration:none;margin-bottom:24px;letter-spacing:-0.01em;">
        Turn Pro back on &mdash; $19/mo &rarr;
      </a>

      <div style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#334155;line-height:1.7;">
        Questions? Reply to this email or reach us at
        <a href="mailto:support@buildorder.ai" style="color:#F59E0B;text-decoration:none;">support@buildorder.ai</a>.
        <br>BuildOrder.ai &mdash; Contractor documents in seconds.
      </div>
    </div>
  </div>
</body></html>`
      });
      await supabase.from('contractor_profiles')
        .update({ founding_lapsed7_sent: true })
        .eq('id', l7.id);
      sent++;
    } catch (e) {
      console.error('founding lapsed7 email failed for', l7.id, e.message);
      errs.push({ type: 'founding_lapsed7', user_id: l7.id, error: e.message });
    }
  }

  // ── Founding member Day +30 lapsed (final touch) ─────────────────────────────
  // Window: pro_expires_at is 29+ days in the PAST — no lower bound, so members
  // who lapsed before this sequence existed still receive exactly one final
  // email. The flag guarantees it only ever sends once.
  var fmL30Before = new Date(now - 29 * 24 * 60 * 60 * 1000).toISOString();

  var { data: lapsed30List } = await supabase
    .from('contractor_profiles')
    .select('id, email, contractor_name, business_name')
    .eq('founding_member', true)
    .eq('founding_lapsed30_sent', false)
    .lte('pro_expires_at', fmL30Before);

  for (var l30 of (lapsed30List || [])) {
    if (!l30.email) continue;
    var l30Name = l30.contractor_name || l30.business_name || l30.email.split('@')[0];
    try {
      await resend.emails.send({
        from:    'BuildOrder <support@buildorder.ai>',
        to:      l30.email,
        subject: 'Last note about your BuildOrder account',
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#0F172A;margin:0;padding:40px 16px;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;border:1px solid rgba(245,158,11,0.2);border-bottom:none;">
      <div style="font-size:24px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:13px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
    </div>
    <div style="background:#111827;border-radius:0 0 14px 14px;padding:32px;border:1px solid rgba(245,158,11,0.2);border-top:none;">
      <h1 style="font-size:22px;font-weight:900;color:#F8FAFC;margin:0 0 10px;letter-spacing:-0.02em;">
        This is the last one.
      </h1>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 20px;">
        ${l30Name}, you were one of the first contractors to sign up for BuildOrder, and I'm not going to keep emailing you about it. This is the last message you'll get from me on this.
      </p>
      <p style="font-size:15px;color:#94A3B8;line-height:1.7;margin:0 0 24px;">
        Your account stays open on the free plan. Every document you made is still in there, and 5 a month is yours for as long as you want it. If the day comes that you need unlimited documents and e-signature again, Pro is right where you left it.
      </p>

      <a href="https://buildorder.ai/pricing.html"
         style="display:block;text-align:center;background:transparent;color:#F59E0B;border:1px solid rgba(245,158,11,0.4);padding:15px 24px;border-radius:10px;font-size:15px;font-weight:800;text-decoration:none;margin-bottom:24px;letter-spacing:-0.01em;">
        See Pro &mdash; $19/mo &rarr;
      </a>

      <div style="padding-top:20px;border-top:1px solid rgba(255,255,255,0.06);font-size:12px;color:#334155;line-height:1.7;">
        If there was something BuildOrder got wrong, I'd take the feedback &mdash; just reply.
        <br>BuildOrder.ai &mdash; Contractor documents in seconds.
      </div>
    </div>
  </div>
</body></html>`
      });
      await supabase.from('contractor_profiles')
        .update({ founding_lapsed30_sent: true })
        .eq('id', l30.id);
      sent++;
    } catch (e) {
      console.error('founding lapsed30 email failed for', l30.id, e.message);
      errs.push({ type: 'founding_lapsed30', user_id: l30.id, error: e.message });
    }
  }

  return res.status(200).json({
    sent,
    checked: expiring.length,
    ...(errs.length > 0 && { errors: errs })
  });
};
