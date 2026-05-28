const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { getEffectivePlan } = require('./_effectivePlan');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // All methods require auth
  const jwt = (req.headers.authorization || '').replace('Bearer ', '');
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  // ── GET — two modes ─────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { action } = req.query;

    // whoami: returns owner info if this user is a team member
    if (action === 'whoami') {
      const { data: membership } = await db
        .from('team_members')
        .select('owner_user_id, status')
        .eq('member_user_id', user.id)
        .eq('status', 'active')
        .single();

      if (!membership) return res.status(200).json({ is_team_member: false });

      const { data: ownerProfile } = await db
        .from('contractor_profiles')
        .select('contractor_name, business_name, plan')
        .eq('id', membership.owner_user_id)
        .single();

      return res.status(200).json({
        is_team_member: true,
        owner_user_id:  membership.owner_user_id,
        owner_name:     ownerProfile?.business_name || ownerProfile?.contractor_name || 'Your employer'
      });
    }

    // Default: list team members (owner view only)
    const { data: profile } = await db
      .from('contractor_profiles')
      .select('contractor_name, business_name, founding_member, pro_expires_at, plan')
      .eq('id', user.id)
      .single();

    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    if (getEffectivePlan(profile) !== 'business') {
      return res.status(403).json({ error: 'Team members are a Business plan feature.' });
    }

    const { data: members } = await db
      .from('team_members')
      .select('id, member_email, status, invited_at, joined_at, member_user_id')
      .eq('owner_user_id', user.id)
      .neq('status', 'removed')
      .order('invited_at', { ascending: false });

    return res.status(200).json({ members: members || [] });
  }

  // ── POST — invite or accept ─────────────────────────────────────────────
  if (req.method === 'POST') {
    const { action, email, token } = req.body || {};

    // ── accept: team member accepts an invite ──────────────────────────────
    if (action === 'accept') {
      if (!token) return res.status(400).json({ error: 'Missing token' });

      const { data: invite, error: invErr } = await db
        .from('team_members')
        .select('id, owner_user_id, member_email, status')
        .eq('token', token)
        .single();

      if (invErr || !invite) return res.status(404).json({ error: 'Invite not found or already used.' });
      if (invite.status === 'active') return res.status(200).json({ success: true, already_active: true });
      if (invite.status === 'removed') return res.status(410).json({ error: 'This invite has been revoked.' });

      // Verify the logged-in user's email matches the invite
      if (user.email?.toLowerCase() !== invite.member_email?.toLowerCase()) {
        return res.status(403).json({
          error: `This invite was sent to ${invite.member_email}. Please sign in with that email address.`
        });
      }

      // Activate the invite
      const { error: updateErr } = await db
        .from('team_members')
        .update({
          member_user_id: user.id,
          status:         'active',
          joined_at:      new Date().toISOString()
        })
        .eq('id', invite.id);

      if (updateErr) {
        console.error('Team accept update failed:', updateErr.message);
        return res.status(500).json({ error: 'Failed to accept invite.' });
      }

      return res.status(200).json({ success: true, owner_user_id: invite.owner_user_id });
    }

    // ── invite: owner sends invite to a team member ──────────────────────
    // (default action)
    const { data: profile } = await db
      .from('contractor_profiles')
      .select('contractor_name, business_name, email, founding_member, pro_expires_at, plan')
      .eq('id', user.id)
      .single();

    if (!profile) return res.status(404).json({ error: 'Profile not found' });
    if (getEffectivePlan(profile) !== 'business') {
      return res.status(403).json({ error: 'Team invites require the Business plan ($39/mo).' });
    }

    if (!email) return res.status(400).json({ error: 'Email is required.' });
    const inviteEmail = email.trim().toLowerCase();

    // Don't let owner invite themselves
    if (inviteEmail === user.email?.toLowerCase()) {
      return res.status(400).json({ error: 'You cannot invite yourself.' });
    }

    // Check if already invited/active
    const { data: existing } = await db
      .from('team_members')
      .select('id, status')
      .eq('owner_user_id', user.id)
      .eq('member_email', inviteEmail)
      .single();

    if (existing && existing.status === 'active') {
      return res.status(409).json({ error: 'This person is already an active team member.' });
    }

    let inviteToken;

    if (existing && existing.status === 'pending') {
      // Resend the existing invite
      const { data: inv } = await db
        .from('team_members')
        .select('token')
        .eq('id', existing.id)
        .single();
      inviteToken = inv?.token;
    } else {
      // Create a new invite record
      const { data: newInvite, error: insertErr } = await db
        .from('team_members')
        .insert({
          owner_user_id: user.id,
          member_email:  inviteEmail
        })
        .select('token')
        .single();

      if (insertErr || !newInvite) {
        console.error('Team invite insert failed:', insertErr?.message);
        return res.status(500).json({ error: 'Failed to create invite.' });
      }
      inviteToken = newInvite.token;
    }

    const bizName   = profile.business_name || profile.contractor_name || 'Your contractor';
    const joinUrl   = `https://buildorder.ai/join.html?token=${inviteToken}`;

    try {
      await resend.emails.send({
        from:    'BuildOrder.ai <noreply@buildorder.ai>',
        to:      inviteEmail,
        subject: `${bizName} invited you to BuildOrder`,
        html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Inter,Arial,sans-serif;background:#F1F5F9;margin:0;padding:40px 16px;">
  <div style="max-width:540px;margin:0 auto;">

    <div style="background:#090E1A;border-radius:14px 14px 0 0;padding:28px 32px;">
      <div style="font-size:20px;font-weight:900;letter-spacing:-0.03em;color:#F8FAFC;">
        <span style="color:#F59E0B;">Build</span>Order<span style="font-size:12px;font-weight:400;color:#94A3B8;">.ai</span>
      </div>
    </div>

    <div style="background:#ffffff;border-radius:0 0 14px 14px;padding:32px;border:1px solid #e5e7eb;border-top:none;">
      <h1 style="font-size:19px;font-weight:900;color:#111827;margin:0 0 10px;">You've been invited to join ${bizName}</h1>
      <p style="font-size:14px;color:#6B7280;line-height:1.7;margin:0 0 24px;">
        <strong style="color:#111827;">${bizName}</strong> is using BuildOrder.ai to generate contractor documents — contracts, estimates, invoices, change orders, and more. They've invited you to access their account.
      </p>

      <a href="${joinUrl}"
         style="display:block;text-align:center;background:#F59E0B;color:#090E1A;padding:14px 24px;border-radius:10px;font-size:15px;font-weight:900;text-decoration:none;margin-bottom:24px;">
        Accept Invitation &rarr;
      </a>

      <p style="font-size:12px;color:#9CA3AF;line-height:1.7;margin:0;">
        You'll create a free BuildOrder account (or sign in with an existing one) and be linked to ${bizName}'s workspace. You won't be charged — your access is covered by their Business plan.
        <br><br>
        If you didn't expect this invite, ignore it.
        <br>Powered by <a href="https://buildorder.ai" style="color:#F59E0B;text-decoration:none;">BuildOrder.ai</a>
      </p>
    </div>
  </div>
</body></html>`
      });
    } catch (emailErr) {
      console.error('Team invite email failed:', emailErr.message);
      return res.status(500).json({ error: 'Invite created but email failed to send. Share this link manually: ' + joinUrl });
    }

    return res.status(200).json({ success: true });
  }

  // ── DELETE — remove a team member ──────────────────────────────────────
  if (req.method === 'DELETE') {
    const { member_id } = req.body || {};
    if (!member_id) return res.status(400).json({ error: 'member_id required' });

    // Verify the caller is the owner
    const { data: member } = await db
      .from('team_members')
      .select('id, owner_user_id')
      .eq('id', member_id)
      .single();

    if (!member || member.owner_user_id !== user.id) {
      return res.status(403).json({ error: 'Not authorized to remove this team member.' });
    }

    const { error: removeErr } = await db
      .from('team_members')
      .update({ status: 'removed' })
      .eq('id', member_id);

    if (removeErr) return res.status(500).json({ error: removeErr.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
