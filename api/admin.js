const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password, action } = req.body || {};
  if (password !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  if (action === 'stats') {
    const { data: stats } = await supabase.rpc('admin_get_stats');
    return res.status(200).json({ success: true, stats });
  }

  if (action === 'users') {
    const limit = req.body.limit || 50;
    const { data: users } = await supabase.rpc('admin_get_recent_users', { lim: limit });

    // Augment with founding member status
    if (users && users.length) {
      const ids = users.map(u => u.id);
      const { data: profiles } = await supabase
        .from('contractor_profiles')
        .select('id, founding_member, pro_expires_at')
        .in('id', ids);
      const profileMap = {};
      (profiles || []).forEach(p => { profileMap[p.id] = p; });
      users.forEach(u => {
        const p = profileMap[u.id] || {};
        u.founding_member = p.founding_member || false;
        u.pro_expires_at  = p.pro_expires_at  || null;
      });
    }

    return res.status(200).json({ success: true, users: users || [] });
  }

  if (action === 'set_plan') {
    const { user_id, plan } = req.body;
    if (!user_id || !plan) return res.status(400).json({ error: 'user_id and plan required' });
    await supabase.from('contractor_profiles').update({ plan }).eq('id', user_id);
    return res.status(200).json({ success: true });
  }

  if (action === 'set_founding_member') {
    const { user_id, founding_member, pro_expires_at } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    await supabase.from('contractor_profiles').update({
      founding_member: !!founding_member,
      pro_expires_at:  founding_member ? (pro_expires_at || '2027-01-01T00:00:00+00:00') : null
    }).eq('id', user_id);
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
};
