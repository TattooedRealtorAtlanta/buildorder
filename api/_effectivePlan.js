/**
 * Plan resolution for BuildOrder.
 *
 * Tiers are ranked. A founding member with an unexpired trial is granted at
 * least 'pro' — but the trial is a FLOOR, not a ceiling. A founding member
 * who also holds a paid Business subscription keeps Business.
 */
const PLAN_RANK = { free: 0, pro: 1, business: 2 };

function rank(plan) {
  return PLAN_RANK[plan] !== undefined ? PLAN_RANK[plan] : 0;
}

/**
 * getEffectivePlan(profile)
 *
 * Returns the user's effective plan string ('free' | 'pro' | 'business').
 * Founding members with a future pro_expires_at get at least 'pro',
 * regardless of their Stripe plan field.
 *
 * @param {object} profile  Row from contractor_profiles
 * @returns {string}
 */
function getEffectivePlan(profile) {
  if (!profile) return 'free';

  const subscribed = profile.plan || 'free';

  if (isFoundingMemberActive(profile)) {
    // Trial grants Pro, but never demotes a higher paid tier.
    return rank(subscribed) > rank('pro') ? subscribed : 'pro';
  }

  return subscribed;
}

/**
 * isFoundingMemberActive(profile)
 * Convenience check used in frontend display logic (passed as JSON).
 */
function isFoundingMemberActive(profile) {
  return !!(
    profile &&
    profile.founding_member &&
    profile.pro_expires_at &&
    new Date(profile.pro_expires_at) > new Date()
  );
}

/**
 * isBusinessPlan(profile)
 *
 * True only for a paid Business subscription. A founding trial alone
 * resolves to 'pro' — the founding offer grants Pro, not Business — so
 * trial members do not get Business-tier features. A founding member who
 * separately pays for Business does.
 *
 * @param {object} profile  Row from contractor_profiles
 * @returns {boolean}
 */
function isBusinessPlan(profile) {
  return getEffectivePlan(profile) === 'business';
}

module.exports = { getEffectivePlan, isFoundingMemberActive, isBusinessPlan };
