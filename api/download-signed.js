const { createClient } = require('@supabase/supabase-js');
const PDFDocument = require('pdfkit');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const TYPE_LABELS = {
  'contract':      'Home Improvement Contract',
  'estimate':      'Estimate',
  'invoice':       'Invoice',
  'proposal':      'Proposal & Contract',
  'change-order':  'Change Order',
  'subcontractor': 'Subcontractor Agreement',
  'lien-waiver':   'Lien Waiver',
  'takeoff':       'Material Takeoff',
  'document':      'Document'
};

function fmtDate(ts) {
  if (!ts) return 'N/A';
  return new Date(ts).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const jwt = (req.headers.authorization || '').replace('Bearer ', '');
  if (!jwt) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error: authErr } = await db.auth.getUser(jwt);
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'token is required' });

  // Verify ownership
  const { data: link, error: linkErr } = await db
    .from('share_links')
    .select('user_id, document_type, document_content, created_at, signed_at, viewed_at, client_name, client_email')
    .eq('token', token)
    .single();

  if (linkErr || !link) return res.status(404).json({ error: 'Document not found' });
  if (link.user_id !== user.id) return res.status(403).json({ error: 'Forbidden' });
  if (!link.signed_at) return res.status(400).json({ error: 'Document has not been signed yet' });

  // Fetch signature record
  const { data: sig } = await db
    .from('document_signatures')
    .select('signature_image, ip_address, user_agent, signed_at, audit_log')
    .eq('document_id', token)
    .single();

  // Fetch contractor profile for branding
  const { data: profile } = await db
    .from('contractor_profiles')
    .select('contractor_name, business_name, email, phone, address, city, state, zip, license_number')
    .eq('id', user.id)
    .single();

  const bizName   = (profile && (profile.business_name || profile.contractor_name)) || 'Contractor';
  const typeLabel = TYPE_LABELS[link.document_type] || 'Document';
  const signedBy  = link.client_name || link.client_email || 'Client';

  // ── Generate PDF ──────────────────────────────────────────────────────────
  const doc = new PDFDocument({ margin: 50, size: 'LETTER', compress: true });
  const chunks = [];
  doc.on('data', chunk => chunks.push(chunk));

  await new Promise((resolve, reject) => {
    doc.on('end', resolve);
    doc.on('error', reject);

    const AMBER  = '#F59E0B';
    const DARK   = '#090E1A';
    const MUTED  = '#64748B';
    const W      = doc.page.width - 100;  // usable width

    // ── Header ──────────────────────────────────────────────────────────────
    doc.rect(50, 50, W, 52).fill(DARK);
    doc.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold')
       .text('BuildOrder', 66, 63, { continued: true });
    doc.fillColor(AMBER).text('.ai');
    doc.fillColor('#94A3B8').fontSize(8).font('Helvetica')
       .text('Contractor Documents in Seconds', 66, 85);
    doc.moveDown(3.5);

    // ── Document meta ────────────────────────────────────────────────────────
    doc.fillColor(DARK).fontSize(14).font('Helvetica-Bold').text(typeLabel);
    doc.moveDown(0.3);
    doc.fillColor(MUTED).fontSize(9).font('Helvetica');
    doc.text(`Prepared by: ${bizName}`, { continued: true });
    if (profile && profile.license_number) doc.text(`   ·   License: ${profile.license_number}`, { continued: true });
    doc.text('');
    doc.text(`Document ID: ${token}`);
    doc.text(`Created: ${fmtDate(link.created_at)}   ·   Viewed: ${fmtDate(link.viewed_at)}   ·   Signed: ${fmtDate(link.signed_at)}`);
    doc.moveDown(0.8);

    // Divider
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#E2E8F0').lineWidth(0.5).stroke();
    doc.moveDown(0.8);

    // ── Document content ─────────────────────────────────────────────────────
    doc.fillColor(DARK).fontSize(8).font('Courier')
       .text(link.document_content || '', { lineGap: 2, paragraphGap: 0 });
    doc.moveDown(1.5);

    // Divider
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#E2E8F0').lineWidth(0.5).stroke();
    doc.moveDown(1);

    // ── Signature block ──────────────────────────────────────────────────────
    doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text('Electronic Signature');
    doc.moveDown(0.5);

    doc.fillColor(MUTED).fontSize(9).font('Helvetica');
    doc.text(`Signed by:    ${signedBy}`);
    if (link.client_email && link.client_name) doc.text(`Email:        ${link.client_email}`);
    doc.text(`Signed at:    ${fmtDate(sig?.signed_at || link.signed_at)}`);
    if (sig?.ip_address) doc.text(`IP Address:   ${sig.ip_address}`);
    doc.moveDown(0.8);

    // Embed drawn/typed signature image
    if (sig?.signature_image) {
      try {
        const base64Data = sig.signature_image.replace(/^data:image\/\w+;base64,/, '');
        const imgBuf = Buffer.from(base64Data, 'base64');
        doc.image(imgBuf, { width: 180, height: 54 });
      } catch (imgErr) {
        doc.fillColor(MUTED).fontSize(8).text('[Signature image unavailable]');
      }
    }

    doc.moveDown(1);

    // ── Audit log ────────────────────────────────────────────────────────────
    doc.moveTo(50, doc.y).lineTo(50 + W, doc.y).strokeColor('#E2E8F0').lineWidth(0.5).stroke();
    doc.moveDown(0.8);
    doc.fillColor(DARK).fontSize(10).font('Helvetica-Bold').text('Audit Trail');
    doc.moveDown(0.4);

    const auditLog = sig?.audit_log || [];
    if (auditLog.length === 0) {
      doc.fillColor(MUTED).fontSize(9).font('Helvetica').text('No audit events recorded.');
    } else {
      auditLog.forEach(function(event) {
        const label = {
          document_viewed:    '📄 Document Viewed',
          signature_applied:  '✍  Signature Applied',
          document_finalized: '✓  Document Finalized',
        }[event.action] || event.action;
        doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text(label, { continued: true });
        doc.font('Helvetica').fillColor(MUTED).text(`   ${fmtDate(event.timestamp)}`);
        if (event.ip_address) {
          doc.fillColor(MUTED).fontSize(8).text(`     IP: ${event.ip_address}`);
        }
      });
    }

    if (sig?.user_agent) {
      doc.moveDown(0.4);
      doc.fillColor(MUTED).fontSize(7.5).font('Helvetica')
         .text(`Browser: ${sig.user_agent}`, { lineBreak: true });
    }

    doc.moveDown(1.2);

    // ── Legal footer ─────────────────────────────────────────────────────────
    doc.rect(50, doc.y, W, 38).fill('#F8FAFC');
    doc.fillColor(MUTED).fontSize(7.5).font('Helvetica')
       .text(
         'This electronic signature is legally binding under the U.S. Electronic Signatures in Global and National Commerce Act (E-SIGN, 15 U.S.C. § 7001). ' +
         'This document and audit trail were generated by BuildOrder.ai.',
         56, doc.y - 32, { width: W - 12, lineGap: 1.5 }
       );

    doc.end();
  });

  const pdf = Buffer.concat(chunks);
  const filename = `signed-${typeLabel.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${token.slice(0, 8)}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', pdf.length);
  res.end(pdf);
};
