import type { RedirectInstruction } from '../core/types.js';

export interface RedirectPageOptions {
  /** Page title shown for the split second before the browser leaves. */
  title?: string;
  /** CSP nonce for the inline auto-submit script, if your site uses a strict CSP. */
  nonce?: string;
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/**
 * A minimal HTML page that sends the browser to the gateway.
 *
 * Needed for eSewa, whose checkout starts with a form POST. Works without JavaScript
 * (a "Continue" button), and every value is HTML-escaped.
 *
 * ```ts
 * res.type('html').send(renderRedirectPage(payment.redirect));
 * ```
 */
export function renderRedirectPage(
  redirect: RedirectInstruction,
  options: RedirectPageOptions = {},
): string {
  const title = escapeHtml(options.title ?? 'Redirecting to payment…');
  const nonce = options.nonce ? ` nonce="${escapeHtml(options.nonce)}"` : '';
  const url = escapeHtml(redirect.url);

  if (redirect.method === 'GET') {
    return document(
      title,
      `<meta http-equiv="refresh" content="0;url=${url}">`,
      `<p><a href="${url}">Continue to payment</a></p>`,
    );
  }

  const inputs = Object.entries(redirect.fields)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join('\n      ');

  return document(
    title,
    '',
    `<form id="nepal-pay-redirect" method="POST" action="${url}">
      ${inputs}
      <noscript><button type="submit">Continue to payment</button></noscript>
    </form>
    <script${nonce}>document.getElementById('nepal-pay-redirect').submit();</script>`,
  );
}

function document(title: string, head: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>${title}</title>
    ${head}
  </head>
  <body>
    ${body}
  </body>
</html>
`;
}
