const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { waiver_id } = req.body || {};
  if (!waiver_id) return res.status(400).json({ error: 'waiver_id required' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: waiver, error: wErr } = await supabase
    .from('lien_waivers').select('*').eq('id', waiver_id).single();
  if (wErr || !waiver) return res.status(404).json({ error: 'Waiver not found' });

  const { data: profile, error: profErr } = await supabase
    .from('contractor_profiles').select('*').eq('id', waiver.user_id).single();
  if (profErr || !profile) return res.status(404).json({ error: 'Profile not found' });

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const jobAddr = [waiver.job_address, waiver.job_city, waiver.job_state, waiver.job_zip].filter(Boolean).join(', ');
  const claimantCompany = waiver.claimant_company || profile.business_name || profile.contractor_name;

  const waiverTypeLabels = {
    conditional_progress:   'Conditional Waiver and Release on Progress Payment',
    unconditional_progress: 'Unconditional Waiver and Release on Progress Payment',
    conditional_final:      'Conditional Waiver and Release on Final Payment',
    unconditional_final:    'Unconditional Waiver and Release on Final Payment'
  };
  const waiverLabel = waiverTypeLabels[waiver.waiver_type] || 'Lien Waiver';

  const isConditional = waiver.waiver_type && waiver.waiver_type.includes('conditional') && !waiver.waiver_type.startsWith('un');
  const isFinal = waiver.waiver_type && waiver.waiver_type.includes('final');

  const conditionText = isConditional
    ? 'This waiver is CONDITIONAL and becomes effective only upon actual receipt and clearance of payment in the amount stated.'
    : 'This waiver is UNCONDITIONAL and effective immediately upon execution, regardless of whether payment has been received.';

  const releaseScope = isFinal
    ? 'Claimant releases ALL claims, liens, and rights to lien for ALL labor, services, equipment, and materials provided through the date stated, and acknowledges this constitutes payment in full.'
    : 'Claimant releases all claims, liens, and rights to lien for labor, services, equipment, and materials provided through the Through Date stated, while reserving all rights for work performed after that date.';

  const prompt = `You are generating a professional lien waiver document. Output ONLY the document — no commentary.

DOCUMENT TYPE: ${waiverLabel}

CLAIMANT (Party waiving lien rights):
Name: ${waiver.claimant_name || profile.contractor_name}
Company: ${claimantCompany}
Address: ${profile.address}, ${profile.city}, ${profile.state} ${profile.zip}
Phone: ${profile.phone}
License: ${profile.license_number || 'N/A'}

CUSTOMER / OWNER (Party receiving the waiver):
Name: ${waiver.customer_name}
Company: ${waiver.customer_company || waiver.customer_name}

JOB PROPERTY:
Address: ${jobAddr}
Owner of Property: ${waiver.property_owner || waiver.customer_name}

WAIVER DETAILS:
Date of Document: ${today}
Through Date (work covered through): ${formatDate(waiver.through_date)}
${waiver.payment_date ? 'Payment Date: ' + formatDate(waiver.payment_date) : ''}
Amount of This Waiver: $${Number(waiver.amount || 0).toFixed(2)}
${waiver.check_number ? 'Check / Payment Reference: ' + waiver.check_number : ''}

CONDITION: ${conditionText}
RELEASE SCOPE: ${releaseScope}

${waiver.notes ? 'Notes: ' + waiver.notes : ''}

FORMAT — generate a formal lien waiver with:
1. HEADER: document title (the waiver type above), date, state (${waiver.job_state || 'the state where the property is located'})
2. CLAIMANT section: full name, company, address
3. CUSTOMER section: name and company
4. PROPERTY: full job address, legal description placeholder [LEGAL DESCRIPTION IF KNOWN]
5. THROUGH DATE and AMOUNT in bold/prominent text
6. CONDITIONAL / UNCONDITIONAL language — if conditional, state clearly that the waiver is ineffective until payment clears; if unconditional, state it is effective immediately
7. RELEASE CLAUSE: clear statement of exactly what lien rights are being waived (use the release scope above)
8. RESERVATION OF RIGHTS (for progress waivers only): explicitly state that claimant reserves all rights for work performed after the Through Date
9. WARRANTY: claimant warrants they have authority to execute this waiver and have paid all sub-tier claimants through the through date
10. NOTARY BLOCK: signature line, printed name, date, notary acknowledgment block (Subscribed and sworn before me...)
11. EXECUTION: signature line and date for claimant

Plain text, === and --- separators, ALL CAPS headers. Short and direct — lien waivers should be dense and legally precise, not verbose.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const waiverText = message.content[0].text;

    const { error: updateErr } = await supabase
      .from('lien_waivers')
      .update({ content: waiverText, status: 'signed' })
      .eq('id', waiver_id);

    if (updateErr) {
      console.error('Update error:', updateErr);
      return res.status(500).json({ error: 'Failed to save waiver' });
    }

    return res.status(200).json({ success: true, waiver_id, content: waiverText });
  } catch (err) {
    console.error('Anthropic error:', err);
    return res.status(500).json({ error: 'Generation failed: ' + err.message });
  }
};
