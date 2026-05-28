const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { getEffectivePlan } = require('./_effectivePlan');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const jwt = (req.headers.authorization || '').replace('Bearer ', '');
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { description, client_name, client_email, client_phone, job_city, job_state } = req.body || {};
  if (!description || description.trim().length < 10) {
    return res.status(400).json({ error: 'Please describe the job in a bit more detail.' });
  }

  // Fetch contractor profile
  const { data: profile, error: profErr } = await db
    .from('contractor_profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profErr || !profile) return res.status(404).json({ error: 'Profile not found' });

  // Usage check
  if (getEffectivePlan(profile) === 'free') {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { count } = await db.from('usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', monthStart);
    if (count !== null && count >= 5) {
      return res.status(402).json({ error: 'usage_limit', message: 'Free plan limit reached (5 docs/month). Upgrade to Pro for unlimited documents.' });
    }
  }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);
  const validUntilStr = validUntil.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const contractorAddress = [profile.address, profile.city, profile.state, profile.zip].filter(Boolean).join(', ');
  const bizName = profile.business_name || profile.contractor_name;

  // Build a placeholder estimate row first so we have an ID and doc_number via trigger
  const { data: estRow, error: insertErr } = await db
    .from('estimates')
    .insert({
      user_id:        user.id,
      homeowner_name: client_name || null,
      homeowner_email:client_email || null,
      homeowner_phone:client_phone || null,
      job_city:       job_city || null,
      job_state:      job_state || null,
      work_type:      'Quick Quote',
      description:    description.trim(),
      status:         'draft',
      valid_days:     30
    })
    .select('id, doc_number')
    .single();

  if (insertErr || !estRow) {
    console.error('Quick Quote insert failed:', insertErr?.message);
    return res.status(500).json({ error: 'Could not create estimate record.' });
  }

  const docNum = estRow.doc_number || ('EST-' + Date.now().toString().slice(-6));

  // Single Anthropic call: extract structure + generate full estimate
  const prompt = `You are an expert contractor estimator. A contractor has described a job in plain English. Your job is to:
1. Extract structured info from the description
2. Generate a complete, professional estimate document

CONTRACTOR INFO:
Name: ${profile.contractor_name}
Business: ${bizName}
Address: ${contractorAddress}
Phone: ${profile.phone || ''}
Email: ${profile.email || ''}
${profile.license_number ? 'License: ' + profile.license_number : ''}

JOB DESCRIPTION FROM CONTRACTOR:
"${description.trim()}"

ADDITIONAL INFO PROVIDED:
${client_name   ? 'Client Name: ' + client_name   : ''}
${client_email  ? 'Client Email: ' + client_email  : ''}
${client_phone  ? 'Client Phone: ' + client_phone  : ''}
${job_city      ? 'City: ' + job_city              : ''}
${job_state     ? 'State: ' + job_state            : ''}

INSTRUCTIONS:
Generate a professional estimate in plain text. Use ===, ---, and spacing for formatting.

Include these sections:
1. HEADER: Contractor name, business, address, phone, email, license (if provided)
2. ESTIMATE label with number ${docNum}, date ${today}, valid until ${validUntilStr}
3. CLIENT INFO: Use provided client name if given, otherwise leave as [CLIENT NAME]. Job location if mentioned.
4. PROJECT SUMMARY: 2-3 sentence description of the scope extracted from the job description
5. LINE ITEMS TABLE: Break the work into logical line items with description, qty, unit, unit price, line total
   - Be specific and realistic — use real contractor pricing
   - Separate demo, labor, materials, and any other phases
   - Include a reasonable estimate of quantities
6. SUBTOTAL, any applicable taxes (mention if tax applies), TOTAL ESTIMATE
7. TERMS: Net 30, estimate valid 30 days, work warranty statement
8. SIGNATURE LINE: Space for contractor signature + date

Extract and infer as much detail as possible from the description. If exact quantities are unclear, use reasonable assumptions based on typical jobs.

After the estimate document, on a new line, add this exact block so I can parse the job details:
---META---
work_type: [2-4 word description of the work type]
estimated_total: [number only, no $ or commas]
job_address: [street address if mentioned, else blank]
---END META---`;

  let aiText = '';
  try {
    const msg = await anthropic.messages.create({
      model:      'claude-sonnet-4-5',
      max_tokens: 4000,
      messages:   [{ role: 'user', content: prompt }]
    });
    aiText = msg.content[0]?.text || '';
  } catch (aiErr) {
    console.error('Quick Quote AI failed:', aiErr.message);
    // Clean up the placeholder row
    await db.from('estimates').delete().eq('id', estRow.id);
    return res.status(500).json({ error: 'AI generation failed. Please try again.' });
  }

  // Parse META block
  let workType      = 'Quick Quote';
  let estimatedTotal = null;
  let jobAddress    = null;

  const metaMatch = aiText.match(/---META---([\s\S]*?)---END META---/);
  if (metaMatch) {
    const metaBlock = metaMatch[1];
    const wt  = metaBlock.match(/work_type:\s*(.+)/);
    const tot = metaBlock.match(/estimated_total:\s*([\d.]+)/);
    const adr = metaBlock.match(/job_address:\s*(.+)/);
    if (wt)  workType       = wt[1].trim();
    if (tot) estimatedTotal = parseFloat(tot[1].trim()) || null;
    if (adr && adr[1].trim()) jobAddress = adr[1].trim();
  }

  // Strip the META block from the document
  const docContent = aiText.replace(/\n?---META---[\s\S]*?---END META---/, '').trim();

  // Update the estimate record with generated content
  const { error: updateErr } = await db
    .from('estimates')
    .update({
      work_type:   workType,
      job_address: jobAddress || null,
      total:       estimatedTotal,
      content:     docContent,
      status:      'draft'
    })
    .eq('id', estRow.id);

  if (updateErr) {
    console.error('Quick Quote update failed:', updateErr.message);
  }

  // Log usage
  await db.from('usage_events').insert({ user_id: user.id, doc_type: 'estimate' });

  return res.status(200).json({
    success:     true,
    estimate_id: estRow.id,
    doc_number:  docNum,
    work_type:   workType
  });
};
