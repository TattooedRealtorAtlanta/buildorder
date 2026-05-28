const { createClient } = require('@supabase/supabase-js');

// Map document type → Supabase table name
const TABLE_MAP = {
  'estimate':      'estimates',
  'invoice':       'invoices',
  'change-order':  'change_orders',
  'subcontractor': 'subcontractor_agreements',
  'lien-waiver':   'lien_waivers',
  'takeoff':       'material_takeoffs',
  'proposal':      'proposals'
};

// Fields to strip before reinserting (system-managed)
const STRIP_FIELDS = ['id', 'created_at', 'updated_at', 'content', 'status'];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: { user }, error: authErr } = await db.auth.getUser(token);
  if (authErr || !user) return res.status(401).json({ error: 'Invalid token' });

  const { type, id } = req.body || {};
  if (!type || !id) return res.status(400).json({ error: 'type and id required' });

  const table = TABLE_MAP[type];
  if (!table) return res.status(400).json({ error: 'Unknown document type: ' + type });

  // Fetch original record — must belong to this user
  const { data: original, error: fetchErr } = await db
    .from(table)
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (fetchErr || !original) return res.status(404).json({ error: 'Document not found' });

  // Build new record — strip system fields, reset content + status
  const newRecord = { ...original };
  STRIP_FIELDS.forEach(f => delete newRecord[f]);
  newRecord.status  = 'draft';
  newRecord.content = null;

  // Insert copy
  const { data: created, error: insertErr } = await db
    .from(table)
    .insert(newRecord)
    .select('id')
    .single();

  if (insertErr) return res.status(500).json({ error: insertErr.message });

  return res.status(200).json({ success: true, new_id: created.id });
};
