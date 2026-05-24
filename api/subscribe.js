const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body || {};

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  try {
    await resend.emails.send({
      from: 'BuildOrder.ai <noreply@writemylyrics.ai>',
      to: 'semiddleton2001@yahoo.com',
      subject: `New founding member signup — ${email}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:2rem;">
          <h2 style="margin:0 0 1rem;font-size:1.2rem;">New BuildOrder.ai signup</h2>
          <p style="margin:0 0 0.5rem;"><strong>Email:</strong> ${email}</p>
          <p style="margin:0 0 1.5rem;color:#666;font-size:0.85rem;">
            ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' })}
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin-bottom:1.5rem;">
          <p style="color:#999;font-size:0.75rem;">Sent from BuildOrder.ai coming soon page</p>
        </div>
      `
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Resend error:', err);
    return res.status(500).json({ error: 'Failed to send notification' });
  }
};
