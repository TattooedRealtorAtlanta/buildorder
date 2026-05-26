const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { takeoff_id, lang } = req.body || {};
  if (!takeoff_id) return res.status(400).json({ error: 'takeoff_id required' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: takeoff, error: tErr } = await supabase
    .from('material_takeoffs').select('*').eq('id', takeoff_id).single();
  if (tErr || !takeoff) return res.status(404).json({ error: 'Takeoff not found' });

  const { data: profile, error: profErr } = await supabase
    .from('contractor_profiles').select('*').eq('id', takeoff.user_id).single();
  if (profErr || !profile) return res.status(404).json({ error: 'Profile not found' });

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const dims = takeoff.dimensions || {};
  const wasteFactor = Number(takeoff.waste_factor || 10);

  let dimensionText = '';
  if (dims.total_sqft) dimensionText += 'Total Area: ' + dims.total_sqft + ' sq ft\n';
  if (dims.length && dims.width) dimensionText += 'Dimensions: ' + dims.length + ' ft x ' + dims.width + ' ft\n';
  if (dims.linear_ft) dimensionText += 'Linear Feet: ' + dims.linear_ft + ' ft\n';
  if (dims.height) dimensionText += 'Height/Depth: ' + dims.height + ' ft\n';
  if (dims.rooms) dimensionText += 'Number of Rooms/Areas: ' + dims.rooms + '\n';
  if (dims.perimeter) dimensionText += 'Perimeter: ' + dims.perimeter + ' ft\n';
  if (dims.custom) dimensionText += 'Additional Dimensions: ' + dims.custom + '\n';

  let prompt = `You are a professional estimator generating a detailed material takeoff for a contractor. Output ONLY the takeoff document — no commentary.

CONTRACTOR: ${profile.business_name || profile.contractor_name}
Date: ${today}
Project: ${takeoff.project_name || 'Untitled Project'}
Project Type: ${takeoff.project_type || 'General Construction'}
Location: ${takeoff.job_address || 'Not specified'}
State: ${profile.state}

PROJECT DESCRIPTION:
${takeoff.description}

DIMENSIONS PROVIDED:
${dimensionText || 'See project description for dimensions'}

WASTE FACTOR: ${wasteFactor}% (add this to all quantities)

${takeoff.notes ? 'Contractor Notes: ' + takeoff.notes : ''}

GENERATE A COMPLETE MATERIAL TAKEOFF including:

1. PROJECT SUMMARY: restate the scope in 2-3 sentences

2. MEASUREMENTS & CALCULATIONS:
   - Show your math: raw area/quantity → add waste factor → order quantity
   - Round up to standard purchase units (sheets, bundles, rolls, bags, gallons, linear ft, etc.)

3. MATERIALS LIST TABLE:
   Format each item as: ITEM | SPEC/SIZE | QTY NEEDED | UNIT | EST. UNIT COST | EST. TOTAL
   - Include ALL materials needed for this project type (don't miss anything)
   - Use realistic current market pricing for the contractor's state (${profile.state})
   - Group by category: Substrate/Base, Finish Materials, Fasteners/Adhesives, Tools/Consumables, Miscellaneous
   - Mark items as "OPTIONAL" if not always required

4. COST SUMMARY:
   - Materials subtotal
   - Tax estimate (use ${profile.state} average sales tax on materials)
   - Delivery/freight estimate if applicable
   - TOTAL ESTIMATED MATERIALS COST

5. ORDERING NOTES:
   - Any lead times to be aware of
   - Items to price shop (lumber, tile, etc.)
   - What to confirm at the job site before ordering
   - Any code or spec requirements for this project type in ${profile.state}

6. WASTE DISPOSAL note: estimated debris/waste for this project

Be thorough — a contractor should be able to hand this to a supplier and order everything needed without missing a single item.`;

  if (lang === 'es') {
    prompt += '\n\nIMPORTANT: Generate this entire document in Spanish. All headers, labels, legal language, and content must be in Spanish.';
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }]
    });

    const takeoffText = message.content[0].text;

    const { error: updateErr } = await supabase
      .from('material_takeoffs')
      .update({ content: takeoffText, status: 'complete' })
      .eq('id', takeoff_id);

    if (updateErr) {
      console.error('Update error:', updateErr);
      return res.status(500).json({ error: 'Failed to save takeoff' });
    }

    return res.status(200).json({ success: true, takeoff_id, content: takeoffText });
  } catch (err) {
    console.error('Anthropic error:', err);
    return res.status(500).json({ error: 'Generation failed: ' + err.message });
  }
};
