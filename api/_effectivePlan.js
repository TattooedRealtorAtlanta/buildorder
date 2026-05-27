/**
 * getEffectivePlan(profile)
 *
 * Returns the user's effective plan string ('free' | 'pro' | 'business').
 * Founding members with a future pro_expires_at get 'pro' regardless of
 * their Stripe plan field.
 *
 * @param {object} profile  Row from contractor_profiles
 * @returns {string}
 */
function getEffectivePlan(profile) {
  if (
    profile.founding_member &&
    profile.pro_expires_at &&
    new Date(profile.pro_expires_at) > new Date()
  ) {
    return 'pro';
  }
  return profile.plan || 'free';
}

/**
 * isFoundingMemberActive(profile)
 * Convenience check used in frontend display logic (passed as JSON).
 */
function isFoundingMemberActive(profile) {
  return (
    profile.founding_member &&
    profile.pro_expires_at &&
    new Date(profile.pro_expires_at) > new Date()
  );
}

module.exports = { getEffectivePlan, isFoundingMemberActive };
