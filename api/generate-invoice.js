const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { invoice_id, lang } = req.body || {};
  if (!invoice_id) return res.status(400).json({ error: 'invoice_id required' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data: invoice, error: invErr } = await supabase
    .from('invoices').select('*').eq('id', invoice_id).single();
  if (invErr || !invoice) return res.status(404).json({ error: 'Invoice not found' });

  const { data: profile, error: profErr } = await supabase
    .from('contractor_profiles').select('*').eq('id', invoice.user_id).single();
  if (profErr || !profile) return res.status(404).json({ error: 'Profile not found' });

  // Usage limit check (free plan: 5 docs/month)
  if (profile.plan === 'free') {
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { count } = await supabase.from('usage_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', invoice.user_id).gte('created_at', monthStart);
    if (count !== null && count >= 5) {
      return res.status(402).json({ error: 'usage_limit', message: 'Free plan limit reached (5 docs/month). Upgrade to Pro for unlimited documents.' });
    }
  }

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + (invoice.due_days || 30));
  const dueDateStr = dueDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const contractorAddr = `${profile.address}, ${profile.city}, ${profile.state} ${profile.zip}`;
  const jobAddr = `${invoice.job_address || ''}, ${invoice.job_city || ''}, ${invoice.job_state || ''} ${invoice.job_zip || ''}`.trim().replace(/^,\s*/, '');

  let lineItemsText = '';
  if (invoice.line_items && Array.isArray(invoice.line_items) && invoice.line_items.length > 0) {
    lineItemsText = invoice.line_items
      .filter(function(item) { return item.description; })
      .map(function(item) {
        var qty = Number(item.quantity || 1);
        var price = Number(item.unit_price || 0);
        var total = qty * price;
        return '- ' + item.description + ': ' + qty + ' ' + (item.unit || 'unit') + ' @ $' + price.toFixed(2) + ' = $' + total.toFixed(2);
      })
      .join('\n');
  }

  var subtotal   = Number(invoice.subtotal    || 0);
  var taxRate    = Number(invoice.tax_rate    || 0);
  var taxAmount  = Number(invoice.tax_amount  || 0);
  var total      = Number(invoice.total       || 0);
  var depositPaid = Number(invoice.deposit_paid || 0);
  var balanceDue = Number(invoice.balance_due || total);

  var invoiceNum = 'INV-' + Date.now().toString().slice(-6);

  var taxLine = taxRate > 0
    ? 'Tax (' + taxRate + '%): $' + taxAmount.toFixed(2)
    : 'Tax: None';

  var depositLine = depositPaid > 0
    ? 'Payments Received: -$' + depositPaid.toFixed(2)
    : '';

  var prompt = `You are generating a professional contractor invoice. Output ONLY the invoice — no commentary before or after.

CONTRACTOR:
Name: ${profile.contractor_name}
Business: ${profile.business_name || profile.contractor_name}
Address: ${contractorAddr}
Phone: ${profile.phone}
Email: ${profile.email}
License: ${profile.license_number || 'N/A'} (${profile.license_type || 'General Contractor'})

CLIENT:
Name: ${invoice.homeowner_name || '[CLIENT]'}
Phone: ${invoice.homeowner_phone || 'N/A'}
Email: ${invoice.homeowner_email || 'N/A'}
Service Address: ${jobAddr || '[ADDRESS]'}

INVOICE:
Invoice Number: ${invoiceNum}
Date Issued: ${today}
Due Date: ${dueDateStr} (Net ${invoice.due_days || 30})
Work Type: ${invoice.work_type || 'General Contracting'}

LINE ITEMS — use EXACTLY these amounts, do not change any numbers:
${lineItemsText || '(No itemized line items — summarize from work type)'}

TOTALS — use EXACTLY these numbers, do not recalculate:
Subtotal: $${subtotal.toFixed(2)}
${taxLine}
Invoice Total: $${total.toFixed(2)}
${depositLine}
BALANCE DUE: $${balanceDue.toFixed(2)}

${invoice.notes ? 'Notes: ' + invoice.notes : ''}

FORMAT:
1. Plain text with === and --- separators. ALL CAPS section headers.
2. Sections in order:
   - HEADER: business name, address, phone, email, license
   - INVOICE: number, date issued, due date
   - BILL TO: client name, phone, email, service address
   - SERVICES RENDERED: 1-2 sentence description of work completed
   - LINE ITEMS: formatted table — DESCRIPTION | QTY | UNIT | UNIT PRICE | AMOUNT
   - SUBTOTAL / TAX / INVOICE TOTAL
   - PAYMENTS RECEIVED (if any)
   - BALANCE DUE — bordered with === lines for emphasis
   - PAYMENT INSTRUCTIONS: accepted methods (check payable to business name, Zelle, ACH/bank transfer, cash). Include business name and email for payment routing.
   - LATE FEE NOTICE: balances unpaid after due date subject to 1.5% monthly finance charge
   - Thank you line
3. Every number must match exactly — never round or recalculate`;

  if (lang === 'es') {
    prompt += '\n\nIMPORTANT: Generate this entire document in Spanish. All headers, labels, legal language, and content must be in Spanish.';
  }

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const invoiceText = message.content[0].text;

    const { error: updateErr } = await supabase
      .from('invoices')
      .update({ content: invoiceText, status: 'sent' })
      .eq('id', invoice_id);

    if (updateErr) {
      console.error('Error updating invoice:', updateErr);
      return res.status(500).json({ error: 'Failed to save invoice' });
    }

    await supabase.from('usage_events').insert({ user_id: invoice.user_id, doc_type: 'invoice' });
    return res.status(200).json({ success: true, invoice_id: invoice_id, content: invoiceText });

  } catch (err) {
    console.error('Anthropic error:', err);
    return res.status(500).json({ error: 'Invoice generation failed: ' + err.message });
  }
};
