const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { category, message, page_url } = req.body || {};
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });

  // Identify user if auth token provided (optional)
  let userId = null;
  let userEmail = null;
  const authHeader = req.headers.authorization || '';
  const jwt = authHeader.replace('Bearer ', '');
  if (jwt) {
    try {
      const { data: { user } } = await db.auth.getUser(jwt);
      if (user) {
        userId = user.id;
        userEmail = user.email;
      }
    } catch(e) { /* anonymous is fine */ }
  }

  // Save to DB
  const { error: dbErr } = await db.from('feedback').insert({
    user_id:   userId || null,
    category:  category || 'general',
    message:   message.trim(),
    page_url:  page_url || null
  });

  if (dbErr) {
    console.error('Feedback DB error:', dbErr.message);
    return res.status(500).json({ error: 'Failed to save feedback' });
  }

  // Email notification to admin
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    const categoryLabels = { bug: '🐛 Bug Report', feature: '✨ Feature Request', general: '💬 General Feedback' };
    const catLabel = categoryLabels[category] || '💬 Feedback';
    try {
      await resend.emails.send({
        from:    'BuildOrder Feedback <noreply@buildorder.ai>',
        to:      [adminEmail],
        subject: `[BuildOrder] ${catLabel}${userEmail ? ' from ' + userEmail : ''}`,
        html: `
          <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;padding:2rem;background:#090E1A;color:#F8FAFC;border-radius:12px;">
            <div style="font-size:1.3rem;font-weight:900;margin-bottom:1.5rem;">
              <span style="color:#F59E0B;">Build</span>Order &mdash; New Feedback
            </div>
            <table style="width:100%;border-collapse:collapse;margin-bottom:1.5rem;font-size:0.85rem;">
              <tr><td style="padding:0.4rem 0;color:#94A3B8;width:100px;">Category</td><td style="padding:0.4rem 0;">${catLabel}</td></tr>
              <tr><td style="padding:0.4rem 0;color:#94A3B8;">From</td><td style="padding:0.4rem 0;">${userEmail || 'Anonymous'}</td></tr>
              ${page_url ? `<tr><td style="padding:0.4rem 0;color:#94A3B8;">Page</td><td style="padding:0.4rem 0;font-size:0.78rem;color:#64748B;">${page_url}</td></tr>` : ''}
            </table>
            <div style="background:#1A2438;border-radius:8px;padding:1.25rem;font-size:0.9rem;line-height:1.7;white-space:pre-wrap;">${message.trim().replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
          </div>
        `
      });
    } catch(e) {
      console.error('Feedback email failed:', e.message);
    }
  }

  return res.status(200).json({ success: true });
};
