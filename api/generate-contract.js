const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Build state template index from all JSON files
// Uses the "code" field inside each file — so mis-named files still map correctly
let STATE_TEMPLATES = null;
function getTemplates() {
  if (STATE_TEMPLATES) return STATE_TEMPLATES;
  STATE_TEMPLATES = {};
  const dir = path.join(__dirname, '..', 'state-templates');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (data.code) {
        // Only overwrite if this file has more mandatory clauses (prefer richer template)
        const existing = STATE_TEMPLATES[data.code];
        if (!existing || (data.mandatory_clauses || []).length >= (existing.mandatory_clauses || []).length) {
          STATE_TEMPLATES[data.code] = data;
        }
      }
    } catch (e) {
      // Skip bad files
    }
  }
  return STATE_TEMPLATES;
}

function formatClauses(template) {
  if (!template || !template.mandatory_clauses) return '';
  return template.mandatory_clauses
    .map(c => `[${c.placement?.toUpperCase() || 'SECTION'}] ${c.label?.toUpperCase()}\n${c.text}`)
    .join('\n\n');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function cancellationDeadline(contractDate) {
  const d = new Date(contractDate || Date.now());
  let days = 0;
  while (days < 3) {
    d.setDate(d.getDate() + 1);
    // Saturday (6) counts as business day under federal law; Sunday (0) does not
    if (d.getDay() !== 0) days++;
  }
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { job_id } = req.body || {};
  if (!job_id) return res.status(400).json({ error: 'job_id required' });

  // Use service role key to load data server-side
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Load job
  const { data: job, error: jobErr } = await supabase
    .from('jobs').select('*').eq('id', job_id).single();
  if (jobErr || !job) return res.status(404).json({ error: 'Job not found' });

  // Load contractor profile
  const { data: profile, error: profErr } = await supabase
    .from('contractor_profiles').select('*').eq('id', job.user_id).single();
  if (profErr || !profile) return res.status(404).json({ error: 'Profile not found' });

  // Get state template
  const templates = getTemplates();
  const template = templates[job.job_state] || templates['FEDERAL'];

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const deadline = cancellationDeadline(new Date().toISOString());

  // Fill template placeholders
  const clauseText = formatClauses(template)
    .replace(/{{contractor_name}}/g, profile.contractor_name || '')
    .replace(/{{contractor_address}}/g, `${profile.address}, ${profile.city}, ${profile.state} ${profile.zip}`)
    .replace(/{{contractor_phone}}/g, profile.phone || '')
    .replace(/{{license_number}}/g, profile.license_number || 'N/A')
    .replace(/{{license_type}}/g, profile.license_type || 'General Contractor')
    .replace(/{{gl_status}}/g, profile.gl_status || 'Active')
    .replace(/{{gl_provider}}/g, profile.gl_provider || 'N/A')
    .replace(/{{homeowner_name}}/g, job.homeowner_name || '')
    .replace(/{{contract_date}}/g, today)
    .replace(/{{cancellation_deadline}}/g, deadline)
    .replace(/{{job_address}}/g, `${job.job_address}, ${job.job_city}, ${job.job_state} ${job.job_zip}`);

  const contractorFullAddress = `${profile.address}, ${profile.city}, ${profile.state} ${profile.zip}`;
  const jobFullAddress = `${job.job_address}, ${job.job_city}, ${job.job_state} ${job.job_zip}`;

  const prompt = `You are a legal document specialist generating a professional, state-compliant home improvement contract. Generate a complete, ready-to-sign contract using the information below.

CONTRACTOR INFORMATION:
Name: ${profile.contractor_name}
Business Name: ${profile.business_name || profile.contractor_name}
Address: ${contractorFullAddress}
Phone: ${profile.phone}
Email: ${profile.email}
License Number: ${profile.license_number || 'N/A'}
License Type: ${profile.license_type || 'General Contractor'}
GL Insurance: ${profile.gl_status} — Provider: ${profile.gl_provider || 'N/A'}

HOMEOWNER INFORMATION:
Name: ${job.homeowner_name}
Address: ${job.homeowner_address || jobFullAddress}
Phone: ${job.homeowner_phone || 'N/A'}
Email: ${job.homeowner_email || 'N/A'}

JOB INFORMATION:
Job Address: ${jobFullAddress}
County: ${job.job_county || 'N/A'}
Type of Work: ${job.work_type}
Project Description: ${job.project_description}
Contract Price: $${Number(job.contract_price).toLocaleString()}
Deposit: $${job.deposit_amount ? Number(job.deposit_amount).toLocaleString() : 'N/A'}
Payment Schedule: ${job.payment_schedule}
Start Date: ${formatDate(job.start_date)}
Estimated Completion: ${formatDate(job.estimated_completion_date)}
Primary Residence: ${job.is_primary_residence ? 'Yes' : 'No'}
Contract Date: ${today}

STATE: ${job.job_state}
STATE RISK LEVEL: ${template?.risk_level || 'LOWER'}
WRITTEN CONTRACT REQUIRED ABOVE: $${template?.written_contract_required_above || 'N/A'}

MANDATORY STATE CLAUSES (include ALL of these verbatim in the appropriate sections):
${clauseText}

INSTRUCTIONS:
1. Generate a complete, professional contract formatted in plain text with clear section headers
2. Include ALL mandatory clauses above exactly as written — do not paraphrase them
3. The contract must include these sections in order:
   - HEADER: Contractor info, license, insurance (from mandatory clauses if provided)
   - CONTRACT FOR HOME IMPROVEMENT SERVICES
   - PARTIES: Contractor and Homeowner full details
   - SCOPE OF WORK: Detailed description of all work to be performed
   - CONTRACT PRICE & PAYMENT SCHEDULE
   - PROJECT TIMELINE
   - MATERIALS & WORKMANSHIP WARRANTY (1 year minimum on workmanship)
   - CHANGES TO SCOPE OF WORK (change order requirement)
   - PERMITS & INSPECTIONS
   - CONTRACTOR'S OBLIGATIONS
   - HOMEOWNER'S OBLIGATIONS
   - LIEN NOTICE (from mandatory clauses)
   - CANCELLATION RIGHTS (from mandatory clauses — include ALL cancellation notices)
   - DISPUTE RESOLUTION
   - GENERAL PROVISIONS
   - SIGNATURE BLOCK (both parties, date lines)
   - FOOTER DISCLAIMER (from mandatory clauses if provided)
4. Use plain text formatting with ===, ---, and ALL CAPS for headers
5. Use professional but plain English — no legalese the average person can't understand
6. Every blank that needs to be filled in should use [BLANK] notation
7. Do not add any commentary before or after the contract — output only the contract itself`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });

    const contractText = message.content[0].text;

    // Save document to Supabase
    const { data: doc, error: docErr } = await supabase.from('documents').insert({
      job_id: job.id,
      user_id: job.user_id,
      doc_type: 'contract',
      content: contractText
    }).select().single();

    if (docErr) {
      console.error('Error saving document:', docErr);
      return res.status(500).json({ error: 'Failed to save document' });
    }

    return res.status(200).json({ success: true, document_id: doc.id, content: contractText });

  } catch (err) {
    console.error('Anthropic error:', err);
    return res.status(500).json({ error: 'Contract generation failed: ' + err.message });
  }
};
