const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { to, subject, message, content, doc_type } = req.body || {};
  if (!to || !content) return res.status(400).json({ error: 'to and content are required' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // Check plan — email is a Pro+ feature
  const { data: profile } = await supabase
    .from('contractor_profiles').select('plan, contractor_name, business_name, email').eq('id', user.id).single();

  if (!profile || profile.plan === 'free') {
    return res.status(402).json({ error: 'upgrade_required', message: 'Email delivery is a Pro feature. Upgrade to send documents directly to clients.' });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromName = profile.business_name || profile.contractor_name || 'BuildOrder';

  // Format the document content as clean HTML
  const docHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:700px;margin:40px auto;color:#222;">
  ${message ? `<p style="margin-bottom:24px;font-size:15px;line-height:1.6;">${message}</p><hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">` : ''}
  <pre style="font-family:'Courier New',Courier,monospace;font-size:12px;line-height:1.75;white-space:pre-wrap;word-break:break-word;background:#f8f8f8;padding:24px;border-radius:8px;border:1px solid #ddd;">${content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>
  <hr style="border:none;border-top:1px solid #ddd;margin:32px 0;">
  <p style="font-size:12px;color:#888;">Sent via BuildOrder.ai &mdash; Contractor Documents in Seconds</p>
</body>
</html>`;

  try {
    await resend.emails.send({
      from: `${fromName} via BuildOrder <noreply@buildorder.ai>`,
      to: [to],
      reply_to: profile.email,
      subject: subject || `Document from ${fromName}`,
      html: docHtml,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Resend error:', err);
    return res.status(500).json({ error: 'Email failed to send: ' + err.message });
  }
};
