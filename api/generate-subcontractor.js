const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function formatDate(dateStr) {
  if (!dateStr) return 'TBD';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { agreement_id } = req.body || {};
  if (!agreement_id) return res.status(400).json({ error: 'agreement_id required' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: agr, error: agrErr } = await supabase
    .from('subcontractor_agreements').select('*').eq('id', agreement_id).single();
  if (agrErr || !agr) return res.status(404).json({ error: 'Agreement not found' });

  const { data: profile, error: profErr } = await supabase
    .from('contractor_profiles').select('*').eq('id', agr.user_id).single();
  if (profErr || !profile) return res.status(404).json({ error: 'Profile not found' });

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const gcAddr = `${profile.address}, ${profile.city}, ${profile.state} ${profile.zip}`;
  const jobAddr = [agr.job_address, agr.job_city, agr.job_state, agr.job_zip].filter(Boolean).join(', ');
  const agrNum = 'SUB-' + Date.now().toString().slice(-6);

  const prompt = `You are generating a professional subcontractor agreement for a general contractor. Output ONLY the agreement — no commentary.

GENERAL CONTRACTOR (Hiring Party):
Name: ${profile.contractor_name}
Business: ${profile.business_name || profile.contractor_name}
Address: ${gcAddr}
Phone: ${profile.phone}
Email: ${profile.email}
License: ${profile.license_number || 'N/A'} (${profile.license_type || 'General Contractor'})
GL Insurance: ${profile.gl_status}${profile.gl_provider ? ' — ' + profile.gl_provider : ''}

SUBCONTRACTOR:
Name: ${agr.sub_name}
Company: ${agr.sub_company || agr.sub_name}
Phone: ${agr.sub_phone || 'N/A'}
Email: ${agr.sub_email || 'N/A'}
License: ${agr.sub_license || 'To be verified'}
Insurance: ${agr.sub_insurance || 'Required — see terms'}

PROJECT:
Job Address: ${jobAddr || 'TBD'}
Work Type: ${agr.work_type || 'Subcontracted Work'}
Start Date: ${formatDate(agr.start_date)}
Estimated Completion: ${formatDate(agr.end_date)}

AGREEMENT DETAILS:
Agreement Number: ${agrNum}
Date: ${today}
Scope of Work: ${agr.scope_of_work}
Contract Amount: $${Number(agr.contract_amount || 0).toFixed(2)}
Payment Terms: ${agr.payment_terms || 'Net 30 upon completion and approval of work'}
${agr.notes ? 'Additional Notes: ' + agr.notes : ''}

INSTRUCTIONS — generate a complete subcontractor agreement with these sections:
1. HEADER: GC business name, address, phone, email, license
2. SUBCONTRACTOR AGREEMENT label with agreement number and date
3. PARTIES: full details for both GC and Sub
4. SCOPE OF WORK: detailed description of sub's responsibilities, expanded from the scope provided
5. CONTRACT PRICE & PAYMENT: total amount, payment schedule/terms, retainage if applicable (standard 10%)
6. PROJECT TIMELINE: start date, completion date, consequences for delay
7. SUBCONTRACTOR'S OBLIGATIONS: quality standards, daily cleanup, coordination with GC, compliance with GC schedule
8. INSURANCE REQUIREMENTS: sub must carry their own GL ($1M per occurrence / $2M aggregate) and Workers Compensation at statutory limits. Sub must provide certificates naming GC as additional insured.
9. INDEPENDENT CONTRACTOR: sub is an independent contractor, not an employee. Sub responsible for own taxes, benefits, and workers.
10. INDEMNIFICATION: sub indemnifies GC against claims arising from sub's work
11. CHANGE ORDERS: no extra work without written change order signed by GC
12. TERMINATION: GC may terminate for cause with written notice, sub must remove equipment and personnel
13. DISPUTE RESOLUTION: binding arbitration
14. SIGNATURE BLOCK: GC and Subcontractor with date lines

Format: plain text, === and --- separators, ALL CAPS headers. Professional but readable.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }]
    });

    const agreementText = message.content[0].text;

    const { error: updateErr } = await supabase
      .from('subcontractor_agreements')
      .update({ content: agreementText, status: 'sent' })
      .eq('id', agreement_id);

    if (updateErr) {
      console.error('Update error:', updateErr);
      return res.status(500).json({ error: 'Failed to save agreement' });
    }

    return res.status(200).json({ success: true, agreement_id, content: agreementText });
  } catch (err) {
    console.error('Anthropic error:', err);
    return res.status(500).json({ error: 'Generation failed: ' + err.message });
  }
};
