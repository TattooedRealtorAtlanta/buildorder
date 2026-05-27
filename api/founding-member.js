const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // ── GET: public spot count ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { count, error } = await db
      .from('contractor_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('founding_member', true);

    const taken = error ? 0 : (count || 0);
    return res.status(200).json({
      count:      taken,
      limit:      50,
      spots_left: Math.max(0, 50 - taken),
      full:       taken >= 50
    });
  }

  // ── POST: grant founding member status ────────────────────────────────────
  if (req.method === 'POST') {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const { data: { user }, error: authErr } = await db.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

    // Check cap
    const { count } = await db
      .from('contractor_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('founding_member', true);

    if (count !== null && count >= 50) {
      return res.status(409).json({
        error:   'founding_member_full',
        message: 'All 50 founding member spots have been claimed.'
      });
    }

    // Check if already a founding member
    const { data: existing } = await db
      .from('contractor_profiles')
      .select('founding_member, pro_expires_at')
      .eq('id', user.id)
      .single();

    if (existing && existing.founding_member && existing.pro_expires_at && new Date(existing.pro_expires_at) > new Date()) {
      return res.status(200).json({ success: true, already_active: true, expires_at: existing.pro_expires_at });
    }

    // Grant — 60 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 60);

    const { error: updateErr } = await db
      .from('contractor_profiles')
      .update({
        founding_member: true,
        pro_expires_at:  expiresAt.toISOString(),
        plan:            'pro'
      })
      .eq('id', user.id);

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    return res.status(200).json({ success: true, expires_at: expiresAt.toISOString() });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
