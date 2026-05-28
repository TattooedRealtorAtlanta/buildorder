const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { getEffectivePlan } = require('./_effectivePlan');
const { buildRateContext } = require('./_rateLibrary');

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

  const { proposal_id } = req.body || {};
  if (!proposal_id) return res.status(400).json({ error: 'proposal_id required' });

  // Fetch proposal record
  const { data: proposal, error: propErr } = await db
    .from('proposals')
    .select('*')
    .eq('id', proposal_id)
    .single();

  if (propErr || !proposal) return res.status(404).json({ error: 'Proposal not found' });

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
      return res.status(402).json({ error: 'usage_limit', message: 'Free plan limit reached (5 docs/month). Upgrade to Pro for unlimited.' });
    }
  }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);
  const validUntilStr = validUntil.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const contractorAddress = [profile.address, profile.city, profile.state, profile.zip].filter(Boolean).join(', ');
  const bizName = profile.business_name || profile.contractor_name;
  const jobLocation = [proposal.job_address, proposal.job_city, proposal.job_state].filter(Boolean).join(', ');
  const depositPct = proposal.deposit_pct || 50;
  const balancePct = 100 - depositPct;

  const rateContext = await buildRateContext(db, user.id);

  const prompt = `You are an expert contractor. Generate a professional PROPOSAL & CONTRACT AGREEMENT document for the job below.

CONTRACTOR:
Name: ${profile.contractor_name}
Business: ${bizName}
Address: ${contractorAddress}
Phone: ${profile.phone || ''}
Email: ${profile.email || ''}
${profile.license_number ? 'License #: ' + profile.license_number : ''}

CLIENT:
Name: ${proposal.homeowner_name || '[CLIENT NAME]'}
Email: ${proposal.homeowner_email || ''}
Phone: ${proposal.homeowner_phone || ''}
Job Location: ${jobLocation || '[JOB ADDRESS]'}

PROPOSAL #: ${proposal.doc_number}
Date: ${today}
Valid Until: ${validUntilStr}

WORK TYPE: ${proposal.work_type || 'General Contractor Work'}
DESCRIPTION:
${proposal.description || ''}

${rateContext}
PAYMENT TERMS:
- Deposit (${depositPct}%) due at signing
- Balance (${balancePct}%) due upon project completion
- Net ${proposal.net_days || 30} days

INSTRUCTIONS:
Generate a complete, professional Proposal & Contract Agreement using plain text. Use === lines, --- lines, and spacing for sections. This document combines the estimate AND the binding contract — one signature covers both.

Structure:
1. HEADER — contractor info, proposal number, date, valid until
2. PREPARED FOR — client name, address
3. PROJECT OVERVIEW — 2-3 sentence summary of the work
4. DETAILED SCOPE OF WORK — itemized list of everything included (and any exclusions)
5. ITEMIZED PRICING — table with description, qty, unit, unit price, line total. Use real contractor pricing. Break out materials, labor, and phases.
6. PROJECT INVESTMENT SUMMARY:
   - Subtotal
   - Tax (if applicable, note it applies)
   - TOTAL INVESTMENT
   - Deposit (${depositPct}%): $X,XXX — Due at signing
   - Balance (${balancePct}%): $X,XXX — Due upon completion
7. ESTIMATED TIMELINE — start date (TBD), estimated duration
8. TERMS & CONDITIONS (use professional contractor language for ${proposal.job_state || 'Georgia'}):
   - Scope & Changes: Any changes must be documented in a written Change Order
   - Materials: Contractor selects materials unless specified; substitutions may be made if equivalent
   - Payment: Failure to pay deposit within 5 days releases contractor from start date commitment
   - Delays: Contractor not liable for delays due to weather, material availability, or acts outside contractor's control
   - Access & Site Conditions: Client responsible for clear site access; unforeseen conditions may require price adjustment
   - Permits: Contractor responsible for required permits unless otherwise noted
   - Warranty: Contractor warrants workmanship for 1 year from completion; material warranties per manufacturer
   - Dispute Resolution: Good-faith negotiation first; disputes subject to binding arbitration in ${proposal.job_state || 'Georgia'}
   - Entire Agreement: This document constitutes the entire agreement between the parties
9. ACCEPTANCE — "By signing below, both parties agree to the scope, pricing, and terms stated in this Proposal & Contract."
   - Contractor signature line + date
   - Client signature line + date + printed name

After the document add:
---META---
estimated_total: [number only, no $ or commas]
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
    console.error('Proposal AI failed:', aiErr.message);
    return res.status(500).json({ error: 'AI generation failed. Please try again.' });
  }

  // Parse META
  let estimatedTotal = null;
  const metaMatch = aiText.match(/---META---([\s\S]*?)---END META---/);
  if (metaMatch) {
    const tot = metaMatch[1].match(/estimated_total:\s*([\d.]+)/);
    if (tot) estimatedTotal = parseFloat(tot[1]) || null;
  }
  const docContent = aiText.replace(/\n?---META---[\s\S]*?---END META---/, '').trim();

  // Update proposal with generated content
  const { error: updateErr } = await db
    .from('proposals')
    .update({ content: docContent, total: estimatedTotal, status: 'draft' })
    .eq('id', proposal.id);

  if (updateErr) console.error('Proposal update failed:', updateErr.message);

  // Log usage
  await db.from('usage_events').insert({ user_id: user.id, doc_type: 'proposal' });

  return res.status(200).json({ success: true, content: docContent, total: estimatedTotal });
};
