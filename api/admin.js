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
    return res.status(200).json({ success: true, users: users || [] });
  }

  if (action === 'set_plan') {
    const { user_id, plan } = req.body;
    if (!user_id || !plan) return res.status(400).json({ error: 'user_id and plan required' });
    await supabase.from('contractor_profiles').update({ plan }).eq('id', user_id);
    return res.status(200).json({ success: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
};
