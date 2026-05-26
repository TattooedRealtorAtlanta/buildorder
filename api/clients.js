const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  // GET — list clients
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('user_id', user.id)
      .order('name');
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ clients: data });
  }

  // POST — create client
  if (req.method === 'POST') {
    const { name, company, phone, email, address, city, state, zip, notes } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const { data, error } = await supabase.from('clients').insert({
      user_id: user.id, name, company, phone, email, address, city, state, zip, notes
    }).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ client: data });
  }

  // PUT — update client
  if (req.method === 'PUT') {
    const { id, name, company, phone, email, address, city, state, zip, notes } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    const { data, error } = await supabase.from('clients')
      .update({ name, company, phone, email, address, city, state, zip, notes, updated_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', user.id)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ client: data });
  }

  // DELETE — delete client
  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });
    const { error } = await supabase.from('clients')
      .delete().eq('id', id).eq('user_id', user.id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
