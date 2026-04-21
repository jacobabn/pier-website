// Shared email templates — the license+receipt email sent after a Stripe
// purchase, and the "re-issue" version sent from the admin dashboard.
//
// Palette mirrors the Pier Drydock direction used on pier.abn.company:
//   bone       #eeece6
//   bone-2     #e4e1d8
//   ink        #0d0d0d
//   ink-mute   #5b5a51
//   line       #cfccc2
//   accent     #a73118   (clay red)
//   accent-warm#c4541e
//
// Emails have to inline everything (no external CSS) and keep to table-based
// layouts + system fonts to survive Outlook/Gmail clipping. The card sits on
// a bone-coloured body, with two inner blocks: the license key (mono) and
// the order summary (Stripe totals + invoice links).

function euro(cents, currency = 'eur') {
  const n = (cents || 0) / 100;
  if (currency.toLowerCase() === 'eur') {
    return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(n);
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(n);
}

function dateLabel(ms) {
  const d = ms ? new Date(ms * 1000) : new Date();
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: '2-digit' });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;',
  }[c]));
}

/**
 * Build the purchase email.
 *
 * @param {Object} opts
 * @param {string} opts.licenseKey      full Ed25519 license string
 * @param {string} opts.email           customer email
 * @param {Object} [opts.invoice]       Stripe invoice object (optional)
 * @param {Object} [opts.session]       Stripe checkout.session (for amount, currency, id)
 * @param {string} [opts.title]         email subject override
 * @param {boolean} [opts.resend]       true if this is an admin re-send (softer copy)
 */
function renderPurchaseEmail(opts) {
  const { licenseKey, email, invoice = null, session = null, resend = false } = opts;

  const orderId = (invoice && invoice.number) || (session && session.id) || '—';
  const amount = invoice ? invoice.amount_paid : (session && session.amount_total);
  const currency = invoice ? invoice.currency : (session && session.currency) || 'eur';
  const totalStr = amount != null ? euro(amount, currency) : '€199,00';
  const subtotal = invoice ? invoice.subtotal : amount;
  const subtotalStr = subtotal != null ? euro(subtotal, currency) : totalStr;
  const tax = invoice ? invoice.tax : null;
  const paidAt = invoice?.status_transitions?.paid_at || session?.created;
  const hostedUrl = invoice?.hosted_invoice_url || null;
  const pdfUrl = invoice?.invoice_pdf || null;

  const heading = resend
    ? 'Your Pier license key (re-sent)'
    : 'Your Pier license is ready.';
  const intro = resend
    ? `As requested, a fresh copy of your license key for <strong>${escapeHtml(email)}</strong>. Any Macs already activated stay active — only the key string itself is refreshed.`
    : `Payment received for <strong>${escapeHtml(email)}</strong>. Paste the key below into Pier — Settings → Activate — and you're in. Works on 2 Macs.`;

  // HTML (inlined styles, table layout for email-client compat)
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#eeece6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eeece6;">
    <tr><td align="center" style="padding:28px 16px 40px;">
      <table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" style="max-width:620px;width:100%;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#0d0d0d;">

        <!-- Header -->
        <tr><td style="padding:4px 0 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="font-family:ui-serif,New York,Charter,Georgia,serif;font-size:22px;font-weight:500;letter-spacing:-0.01em;color:#0d0d0d;">Pier</td>
              <td align="right" style="font-family:ui-monospace,SF Mono,Menlo,monospace;font-size:11px;color:#5b5a51;letter-spacing:0.08em;text-transform:uppercase;">${escapeHtml(resend ? 'Re-issue' : 'Purchase confirmation')}</td>
            </tr>
          </table>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#ffffff;border:1px solid #cfccc2;border-radius:12px;padding:36px 36px 32px;">

          <!-- Title -->
          <h1 style="margin:0 0 10px;font-family:ui-serif,New York,Charter,Georgia,serif;font-size:28px;font-weight:500;line-height:1.2;letter-spacing:-0.02em;color:#0d0d0d;">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#2a2620;">${intro}</p>

          <!-- License key block -->
          <div style="background:#eeece6;border:1px solid #cfccc2;border-radius:8px;padding:16px 18px;margin:0 0 28px;">
            <div style="font-family:ui-monospace,SF Mono,Menlo,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#5b5a51;margin:0 0 8px;">Your license key</div>
            <div style="font-family:ui-monospace,SF Mono,Menlo,monospace;font-size:13px;line-height:1.5;color:#0d0d0d;word-break:break-all;user-select:all;-webkit-user-select:all;">${escapeHtml(licenseKey)}</div>
          </div>

          <!-- Order summary -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
            <tr><td style="padding:0 0 10px;border-bottom:1px solid #cfccc2;">
              <div style="font-family:ui-monospace,SF Mono,Menlo,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#5b5a51;">Order summary</div>
            </td></tr>
            <tr><td style="padding:14px 0;border-bottom:1px solid #cfccc2;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:14px;line-height:1.5;color:#0d0d0d;">
                    <strong style="display:block;color:#0d0d0d;">Pier — AI for legacy websites</strong>
                    <span style="color:#5b5a51;font-size:13px;">One-time license · 2 Macs · 30-day refund</span>
                  </td>
                  <td align="right" style="font-variant-numeric:tabular-nums;font-size:14px;color:#0d0d0d;white-space:nowrap;">${subtotalStr}</td>
                </tr>
              </table>
            </td></tr>
            ${tax && tax > 0 ? `<tr><td style="padding:10px 0;border-bottom:1px solid #cfccc2;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:13px;color:#5b5a51;">VAT</td>
                  <td align="right" style="font-variant-numeric:tabular-nums;font-size:13px;color:#5b5a51;white-space:nowrap;">${euro(tax, currency)}</td>
                </tr>
              </table>
            </td></tr>` : ''}
            <tr><td style="padding:14px 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size:14px;font-weight:600;color:#0d0d0d;">Total paid</td>
                  <td align="right" style="font-variant-numeric:tabular-nums;font-size:16px;font-weight:600;color:#0d0d0d;white-space:nowrap;">${totalStr}</td>
                </tr>
              </table>
            </td></tr>
          </table>

          <!-- Meta -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;font-size:12px;color:#5b5a51;">
            <tr>
              <td style="padding:4px 0;">Order #<span style="font-family:ui-monospace,SF Mono,Menlo,monospace;color:#2a2620;">${escapeHtml(orderId)}</span></td>
              <td align="right" style="padding:4px 0;">${escapeHtml(dateLabel(paidAt))}</td>
            </tr>
          </table>

          ${hostedUrl || pdfUrl ? `<!-- Invoice links -->
          <div style="margin:0 0 26px;">
            ${hostedUrl ? `<a href="${escapeHtml(hostedUrl)}" style="display:inline-block;margin:0 8px 8px 0;padding:9px 16px;background:#0d0d0d;color:#eeece6;border-radius:6px;text-decoration:none;font-size:13px;font-weight:500;">View invoice online</a>` : ''}
            ${pdfUrl ? `<a href="${escapeHtml(pdfUrl)}" style="display:inline-block;margin:0 8px 8px 0;padding:9px 16px;background:#a73118;color:#ffffff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:500;">Download PDF invoice</a>` : ''}
          </div>` : ''}

          <!-- Next steps -->
          <div style="background:#eeece6;border-radius:8px;padding:18px 20px;margin:0 0 8px;">
            <div style="font-family:ui-monospace,SF Mono,Menlo,monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#5b5a51;margin:0 0 10px;">Next steps</div>
            <ol style="margin:0;padding:0 0 0 20px;font-size:14px;line-height:1.7;color:#2a2620;">
              <li>Download Pier from <a href="https://pier.abn.company/download" style="color:#a73118;text-decoration:underline;">pier.abn.company/download</a>.</li>
              <li>Open Pier, click <strong>Settings → Activate</strong>, paste the key above.</li>
              <li>Use Pier on a second Mac with the same key — works on 2 Macs per license.</li>
            </ol>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:22px 12px 0;font-size:12px;line-height:1.6;color:#5b5a51;">
          <div>Questions? Reply directly to this email or write to <a href="mailto:info@abn.company" style="color:#0d0d0d;">info@abn.company</a>.</div>
          <div style="margin-top:16px;padding-top:14px;border-top:1px solid #cfccc2;color:#7b7163;font-size:11px;">
            A Brand New Company B.V. · Amsterdam, NL<br>
            KvK <span style="font-family:ui-monospace,SF Mono,Menlo,monospace;">88565548</span> · BTW <span style="font-family:ui-monospace,SF Mono,Menlo,monospace;">NL004626508B12</span><br>
            <a href="https://pier.abn.company" style="color:#7b7163;text-decoration:underline;">pier.abn.company</a>
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // Plain-text fallback
  const text = [
    heading,
    '',
    `Order:   ${orderId}`,
    `Date:    ${dateLabel(paidAt)}`,
    `Total:   ${totalStr}${tax && tax > 0 ? ` (incl. ${euro(tax, currency)} VAT)` : ''}`,
    ...(hostedUrl ? [`Invoice: ${hostedUrl}`] : []),
    ...(pdfUrl ? [`PDF:     ${pdfUrl}`] : []),
    '',
    'Your license key:',
    '',
    licenseKey,
    '',
    'Next steps:',
    '  1. Download Pier from https://pier.abn.company/download',
    "  2. Open Pier → Settings → Activate — paste the key above",
    '  3. Works on 2 Macs per license',
    '',
    'Questions? Reply to this email or write to info@abn.company.',
    '',
    '— A Brand New Company B.V. · Amsterdam · KvK 88565548 · BTW NL004626508B12',
  ].join('\n');

  return { subject: heading, html, text };
}

module.exports = { renderPurchaseEmail };
