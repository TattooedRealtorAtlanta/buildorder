const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { getEffectivePlan } = require('./_effectivePlan');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { change_order_id, lang } = req.body || {};
  if (!change_order_id) return res.status(400).json({ error: 'change_order_id required' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data: co, error: coErr } = await supabase
    .from('change_orders').select('*').eq('id', change_order_id).single();
  if (coErr || !co) return res.status(404).json({ error: 'Change order not found' });

  const { data: profile, error: profErr } = await supabase
    .from('contractor_profiles').select('*').eq('id', co.user_id).single();
  if (profErr || !profile) return res.status(404).json({ error: 'Profile not found' });

  // Usage limit check (free plan: 5 docs/month)
  if (getEffectivePlan(profile) === 'free') {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { count } = await supabase.from('usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', co.user_id).gte('created_at', monthStart);
    if (count !== null && count >= 5) {
      return res.status(402).json({ error: 'usage_limit', message: 'Free plan limit reached (5 docs/month). Upgrade to Pro for unlimited documents.' });
    }
  }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const contractorAddr = `${profile.address}, ${profile.city}, ${profile.state} ${profile.zip}`;
  const jobAddr = [co.job_address, co.job_city, co.job_state, co.job_zip].filter(Boolean).join(', ');

  var origPrice   = Number(co.original_contract_price || 0);
  var changeAmt   = Number(co.change_amount || 0);
  var newTotal    = Number(co.new_total || (origPrice + changeAmt));
  var addDays     = Number(co.additional_days || 0);
  var coNum       = co.doc_number || ('CO-' + Date.now().toString().slice(-6));

  var changeSign  = changeAmt >= 0 ? '+' : '';
  var timeImpact  = addDays > 0
    ? addDays + ' additional calendar day' + (addDays === 1 ? '' : 's')
    : addDays < 0
      ? Math.abs(addDays) + ' fewer calendar day' + (Math.abs(addDays) === 1 ? '' : 's')
      : 'No change to project timeline';

  let prompt = `You are generating a professional contractor change order document. Output ONLY the document — no commentary.

CONTRACTOR:
Name: ${profile.contractor_name}
Business: ${profile.business_name || profile.contractor_name}
Address: ${contractorAddr}
Phone: ${profile.phone}
Email: ${profile.email}
License: ${profile.license_number || 'N/A'} (${profile.license_type || 'General Contractor'})

CLIENT:
Name: ${co.homeowner_name || '[CLIENT]'}
Phone: ${co.homeowner_phone || 'N/A'}
Email: ${co.homeowner_email || 'N/A'}
Job Address: ${jobAddr || '[ADDRESS]'}

CHANGE ORDER:
Change Order Number: ${coNum}
Date: ${today}
Work Type: ${co.work_type || 'General Contracting'}

ORIGINAL CONTRACT INFORMATION:
Original Scope of Work: ${co.original_scope || co.work_type || 'As previously contracted'}
Original Contract Price: $${origPrice.toFixed(2)}

THIS CHANGE ORDER:
Description of Change: ${co.change_description}
Reason for Change: ${co.reason || 'Owner-requested change'}
Price Change: ${changeSign}$${Math.abs(changeAmt).toFixed(2)}
Timeline Impact: ${timeImpact}
NEW CONTRACT TOTAL: $${newTotal.toFixed(2)}

${co.notes ? 'Additional Notes: ' + co.notes : ''}

FORMAT:
1. Plain text with === and --- separators, ALL CAPS section headers
2. Sections in order:
   - HEADER: contractor info, license, date
   - CHANGE ORDER label with CO number and date
   - PARTIES: contractor and client with full contact info
   - ORIGINAL CONTRACT SUMMARY: original scope and original price
   - DESCRIPTION OF CHANGE: detailed explanation of what is being added, removed, or modified — write 2-4 sentences expanding on the description provided
   - PRICE ADJUSTMENT: original price, change amount, new contract total — present in a clear table
   - SCHEDULE IMPACT: timeline change if any
   - AGREEMENT: state that this change order modifies the original contract, all other terms remain in effect, work will not begin on these changes until signed by both parties
   - AUTHORIZATION REQUIRED: note that unsigned change orders are not valid and no additional work will proceed without written authorization
   - SIGNATURE BLOCK: Contractor signature/date and Client signature/date with printed name lines
3. Keep language professional but readable — a homeowner should understand every line`;

  if (lang === 'es') {
    prompt += '\n\nIMPORTANT: Generate this entire document in Spanish. All headers, labels, legal language, and content must be in Spanish.';
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const coText = message.content[0].text;

    const { error: updateErr } = await supabase
      .from('change_orders')
      .update({ content: coText, status: 'sent' })
      .eq('id', change_order_id);

    if (updateErr) {
      console.error('Error updating change order:', updateErr);
      return res.status(500).json({ error: 'Failed to save change order' });
    }

    await supabase.from('usage_events').insert({ user_id: co.user_id, doc_type: 'change_order' });
    return res.status(200).json({ success: true, change_order_id: change_order_id, content: coText });

  } catch (err) {
    console.error('Anthropic error:', err);
    return res.status(500).json({ error: 'Change order generation failed: ' + err.message });
  }
};
