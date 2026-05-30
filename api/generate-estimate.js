const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { getEffectivePlan } = require('./_effectivePlan');
const { buildRateContext } = require('./_rateLibrary');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { estimate_id, lang } = req.body || {};
  if (!estimate_id) return res.status(400).json({ error: 'estimate_id required' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data: estimate, error: estErr } = await supabase
    .from('estimates').select('*').eq('id', estimate_id).single();
  if (estErr || !estimate) return res.status(404).json({ error: 'Estimate not found' });

  const { data: profile, error: profErr } = await supabase
    .from('contractor_profiles').select('*').eq('id', estimate.user_id).single();
  if (profErr || !profile) return res.status(404).json({ error: 'Profile not found' });

  // Usage limit check (free plan: 5 docs/month)
  if (getEffectivePlan(profile) === 'free') {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { count } = await supabase.from('usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', estimate.user_id).gte('created_at', monthStart);
    if (count !== null && count >= 5) {
      return res.status(402).json({ error: 'usage_limit', message: 'Free plan limit reached (5 docs/month). Upgrade to Pro for unlimited documents.' });
    }
  }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (estimate.valid_days || 30));
  const validUntilStr = validUntil.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const contractorFullAddress = `${profile.address}, ${profile.city}, ${profile.state} ${profile.zip}`;
  const jobFullAddress = `${estimate.job_address || ''}, ${estimate.job_city || ''}, ${estimate.job_state || ''} ${estimate.job_zip || ''}`.trim().replace(/^,\s*/, '');

  // Format any manually entered line items
  let manualLineItems = '';
  if (estimate.line_items && Array.isArray(estimate.line_items) && estimate.line_items.length > 0) {
    manualLineItems = '\n\nCONTRACTOR-SPECIFIED LINE ITEMS (include these exactly, do not change descriptions or prices):\n' +
      estimate.line_items
        .filter(item => item.description)
        .map(item => `- ${item.description}: ${item.quantity || 1} ${item.unit || 'unit'} @ $${Number(item.unit_price || 0).toFixed(2)}`)
        .join('\n');
  }

  const taxNote = estimate.tax_rate > 0
    ? `Apply ${estimate.tax_rate}% tax to materials only (not labor).`
    : 'No tax applies to this estimate.';

  const rateContext = await buildRateContext(supabase, estimate.user_id);

  let prompt = `You are a professional estimating specialist generating a detailed home improvement estimate. Generate a complete, ready-to-send estimate using the information below.

CONTRACTOR INFORMATION:
Name: ${profile.contractor_name}
Business Name: ${profile.business_name || profile.contractor_name}
Address: ${contractorFullAddress}
Phone: ${profile.phone}
Email: ${profile.email}
License Number: ${profile.license_number || 'N/A'}
License Type: ${profile.license_type || 'General Contractor'}
GL Insurance: ${profile.gl_status}${profile.gl_provider ? ' — ' + profile.gl_provider : ''}

HOMEOWNER / CLIENT:
Name: ${estimate.homeowner_name || '[HOMEOWNER NAME]'}
Phone: ${estimate.homeowner_phone || 'N/A'}
Email: ${estimate.homeowner_email || 'N/A'}
Job Address: ${jobFullAddress || '[JOB ADDRESS]'}

JOB DETAILS:
Type of Work: ${estimate.work_type || 'General Home Improvement'}
Project Description: ${estimate.project_description}
${manualLineItems}

${rateContext}
ESTIMATE TERMS:
Date: ${today}
Valid Until: ${validUntilStr} (${estimate.valid_days || 30} days)
Tax: ${taxNote}
${estimate.notes ? 'Additional Notes: ' + estimate.notes : ''}

INSTRUCTIONS:
1. Generate a professional estimate in plain text with clear formatting using ===, ---, and spacing
2. Include these sections in order:
   - HEADER: Contractor name, business name, address, phone, email, license number
   - ESTIMATE label with estimate number (use ${estimate.doc_number || ('EST-' + Date.now().toString().slice(-6))}), date, valid until date
   - CLIENT INFO: Homeowner name, job address
   - PROJECT SUMMARY: Brief description of work scope
   - LINE ITEMS TABLE: Itemized list with description, quantity, unit, unit price, and line total
     * Break the work into logical line items (demo, labor, materials, etc.)
     * If contractor specified line items above, include them exactly — add any additional items needed
     * If no line items were specified, create realistic line items based on the project description
     * Format as: DESCRIPTION | QTY | UNIT | UNIT PRICE | TOTAL
   - SUBTOTAL
   - TAX (if applicable)
   - TOTAL ESTIMATE
   - PAYMENT TERMS: Standard contractor payment terms (deposit on acceptance, balance on completion)
   - TERMS & CONDITIONS: 3-5 standard clauses (scope changes require written change order, estimate valid for stated days, prices subject to change if materials costs change significantly, etc.)
   - ACCEPTANCE LINE: Signature, printed name, date lines for homeowner acceptance
3. Use realistic pricing for the described work — don't use $0 or placeholder amounts
4. Format numbers with dollar signs and two decimal places
5. Keep language professional but plain — a homeowner should understand every line
6. Do not add commentary before or after the estimate — output only the estimate itself`;

  if (lang === 'es') {
    prompt += '\n\nIMPORTANT: Generate this entire document in Spanish. All headers, labels, legal language, and content must be in Spanish.';
  } else if (lang === 'bilingual') {
    prompt += '\n\nIMPORTANT: Generate this document in BOTH English and Spanish. Output the complete English version first, then add a divider line "========================================\nVERSIÓN EN ESPAÑOL / SPANISH VERSION\n========================================", then output the complete Spanish translation. The Spanish version must be a full, professional translation of the entire document — not abbreviated.';
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: lang === 'bilingual' ? 6000 : 3000,
      messages: [{ role: 'user', content: prompt }]
    });

    const estimateText = message.content[0].text;

    // Save generated content back to estimate
    const { data: updated, error: updateErr } = await supabase
      .from('estimates')
      .update({ content: estimateText, status: 'sent' })
      .eq('id', estimate_id)
      .select()
      .single();

    if (updateErr) {
      console.error('Error updating estimate:', updateErr);
      return res.status(500).json({ error: 'Failed to save estimate' });
    }

    await supabase.from('usage_events').insert({ user_id: estimate.user_id, doc_type: 'estimate' });
    return res.status(200).json({ success: true, estimate_id: estimate_id, content: estimateText });

  } catch (err) {
    console.error('Anthropic error:', err);
    return res.status(500).json({ error: 'Estimate generation failed: ' + err.message });
  }
};
