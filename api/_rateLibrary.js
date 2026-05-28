/**
 * Builds a pricing context string to inject into AI prompts.
 * Pulls labor_rate + markup_pct from contractor_profiles,
 * and specific line item prices from line_item_templates.
 *
 * Returns empty string if the contractor hasn't set up any rates yet,
 * so prompts degrade gracefully to Claude's location-based estimates.
 */
async function buildRateContext(db, userId) {
  const [profileRes, itemsRes] = await Promise.all([
    db.from('contractor_profiles')
      .select('labor_rate, markup_pct')
      .eq('id', userId)
      .single(),
    db.from('line_item_templates')
      .select('description, unit, unit_price')
      .eq('user_id', userId)
      .order('description')
  ]);

  const profile = profileRes.data || {};
  const items   = itemsRes.data || [];

  const hasRate   = profile.labor_rate && Number(profile.labor_rate) > 0;
  const hasMarkup = profile.markup_pct  && Number(profile.markup_pct)  > 0;
  const hasItems  = items.length > 0;

  if (!hasRate && !hasMarkup && !hasItems) return '';

  let ctx = '\nCONTRACTOR PRICING (use these — do not substitute your own guesses):\n';

  if (hasRate) {
    ctx += `Labor rate: $${Number(profile.labor_rate).toFixed(2)}/hr\n`;
  }
  if (hasMarkup) {
    ctx += `Material markup: ${profile.markup_pct}% (apply this markup on top of material costs)\n`;
  }
  if (hasItems) {
    ctx += 'Price list (use these exact prices when this material/service appears in the job):\n';
    items.forEach(function(item) {
      var unitStr = item.unit ? '/' + item.unit : '';
      ctx += `  - ${item.description}: $${Number(item.unit_price).toFixed(2)}${unitStr}\n`;
    });
  }

  return ctx;
}

module.exports = { buildRateContext };
