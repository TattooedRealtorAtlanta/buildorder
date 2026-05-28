const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Auth
  const jwt = (req.headers.authorization || '').replace('Bearer ', '');
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' });
  const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { image_base64, media_type } = req.body || {};
  if (!image_base64) return res.status(400).json({ error: 'Missing image_base64' });

  const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const imgType = validTypes.includes(media_type) ? media_type : 'image/jpeg';

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: imgType, data: image_base64 }
          },
          {
            type: 'text',
            text: `You are a contractor estimating assistant. Analyze this job site photo and identify what work is needed.

Return ONLY a JSON object with no markdown, no explanation, exactly this format:
{
  "work_type": "short work category (e.g. Roof Replacement, Bathroom Remodel, Exterior Painting, HVAC Repair)",
  "scope": "2-3 sentence plain English description of the work visible in this photo — what needs to be done and why",
  "notes": "1 sentence noting any specific conditions, damage, or materials visible that would affect pricing — or empty string if none"
}`
          }
        ]
      }]
    });

    const raw = response.content[0].text.trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { work_type: '', scope: raw, notes: '' };
    }

    return res.status(200).json({
      success: true,
      work_type: parsed.work_type || '',
      scope:     parsed.scope     || '',
      notes:     parsed.notes     || ''
    });

  } catch (err) {
    console.error('analyze-photo error:', err.message);
    return res.status(500).json({ error: 'Photo analysis failed. Please try again.' });
  }
};
