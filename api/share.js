const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

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
      .select('id, token, document_content, document_type, client_name, client_email, client_sig, signed_at, expires_at, created_at')
      .eq('token', token)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Link not found' });

    // Check expiration
    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Link expired' });
    }

    return res.status(200).json(data);
  }

  // ── POST ────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};

    // ── POST action=sign: public — no auth required ──────────────────────
    if (body.action === 'sign') {
      const { token, client_name, client_email, client_sig } = body;
      if (!token || !client_sig) return res.status(400).json({ error: 'Missing required fields' });

      // Verify link exists and isn't expired
      const { data: link, error: fetchErr } = await db
        .from('share_links')
        .select('id, expires_at, signed_at')
        .eq('token', token)
        .single();

      if (fetchErr || !link) return res.status(404).json({ error: 'Link not found' });
      if (link.expires_at && new Date(link.expires_at) < new Date()) {
        return res.status(410).json({ error: 'Link expired' });
      }
      if (link.signed_at) return res.status(409).json({ error: 'Already signed' });

      const { error: updateErr } = await db
        .from('share_links')
        .update({
          client_name: client_name || null,
          client_email: client_email || null,
          client_sig,
          signed_at: new Date().toISOString()
        })
        .eq('token', token);

      if (updateErr) return res.status(500).json({ error: updateErr.message });
      return res.status(200).json({ success: true });
    }

    // ── POST default: create share link — auth required ──────────────────
    const authHeader = req.headers.authorization || '';
    const jwt = authHeader.replace('Bearer ', '');
    if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

    // Validate user
    const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

    const { document_content, document_type } = body;
    if (!document_content) return res.status(400).json({ error: 'Missing document_content' });

    const { data: link, error: insertErr } = await db
      .from('share_links')
      .insert({
        user_id: user.id,
        document_content,
        document_type: document_type || 'document'
      })
      .select('token')
      .single();

    if (insertErr) return res.status(500).json({ error: insertErr.message });

    const shareUrl = `https://buildorder.ai/sign.html?token=${link.token}`;
    return res.status(200).json({ url: shareUrl, token: link.token });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
