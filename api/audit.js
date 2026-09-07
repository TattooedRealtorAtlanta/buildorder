const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const jwt = (req.headers.authorization || '').replace('Bearer ', '');
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token is required' });

  // Verify the requesting contractor owns this document
  const { data: link, error: linkErr } = await db
    .from('share_links')
    .select('id, user_id, document_type, created_at, viewed_at, signed_at, client_name, client_email')
    .eq('token', token)
    .single();

  if (linkErr || !link) return res.status(404).json({ error: 'Document not found' });
  if (link.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' });

  // Fetch the signature + audit record
  const { data: sig } = await db
    .from('document_signatures')
    .select('id, ip_address, user_agent, signed_at, audit_log')
    .eq('document_id', token)
    .single();

  return res.status(200).json({
    document: {
      token,
      type:        link.document_type,
      created_at:  link.created_at,
      viewed_at:   link.viewed_at  || null,
      signed_at:   link.signed_at  || null,
      client_name:  link.client_name  || null,
      client_email: link.client_email || null,
    },
    signature: sig ? {
      id:         sig.id,
      ip_address: sig.ip_address,
      user_agent: sig.user_agent,
      signed_at:  sig.signed_at,
    } : null,
    audit_log: sig?.audit_log || [],
  });
};
