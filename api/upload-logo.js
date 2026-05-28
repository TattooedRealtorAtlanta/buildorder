const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const MAX_BYTES     = 2 * 1024 * 1024; // 2 MB

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const jwt = (req.headers.authorization || '').replace('Bearer ', '');
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  // ── DELETE: remove logo ───────────────────────────────────────────────
  if (req.method === 'DELETE') {
    // Remove from storage (best-effort — don't block on error)
    const { data: profile } = await db
      .from('contractor_profiles')
      .select('logo_url')
      .eq('id', user.id)
      .single();

    if (profile?.logo_url) {
      // Extract the path from the public URL
      try {
        const url  = new URL(profile.logo_url);
        const path = url.pathname.split('/logos/')[1];
        if (path) await db.storage.from('logos').remove([path]);
      } catch (e) {
        console.error('Logo remove from storage failed:', e.message);
      }
    }

    await db.from('contractor_profiles').update({ logo_url: null }).eq('id', user.id);
    return res.status(200).json({ success: true });
  }

  // ── POST: upload logo ─────────────────────────────────────────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { base64, mimeType, ext } = req.body || {};
  if (!base64 || !mimeType || !ext) return res.status(400).json({ error: 'Missing base64, mimeType, or ext' });

  const normalizedType = mimeType.toLowerCase().replace('image/jpg', 'image/jpeg');
  if (!ALLOWED_TYPES.includes(normalizedType)) {
    return res.status(400).json({ error: 'Only JPG, PNG, GIF, WebP, and SVG are allowed.' });
  }

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_BYTES) {
    return res.status(400).json({ error: 'Logo must be under 2 MB.' });
  }

  const safeExt  = ext.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 5);
  const filePath = `${user.id}/logo.${safeExt}`;

  const { error: uploadErr } = await db.storage
    .from('logos')
    .upload(filePath, buffer, { contentType: normalizedType, upsert: true });

  if (uploadErr) {
    console.error('Logo upload failed:', uploadErr.message);
    return res.status(500).json({ error: 'Upload failed: ' + uploadErr.message });
  }

  const { data: urlData } = db.storage.from('logos').getPublicUrl(filePath);
  // Append a cache-buster so the browser picks up the new image immediately
  const logoUrl = urlData.publicUrl + '?v=' + Date.now();

  const { error: saveErr } = await db
    .from('contractor_profiles')
    .update({ logo_url: logoUrl })
    .eq('id', user.id);

  if (saveErr) {
    console.error('Logo URL save failed:', saveErr.message);
    return res.status(500).json({ error: 'Uploaded but could not save URL: ' + saveErr.message });
  }

  return res.status(200).json({ success: true, logo_url: logoUrl });
};
