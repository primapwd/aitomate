/**
 * Plain-language mapping for raw browser/network error strings that would
 * otherwise leak to PO-facing surfaces (Constitution: fail loud, fail
 * clear). Pure module — no `browser.*` import, testable without fakes.
 *
 * Known Chrome runtime and network-error strings are mapped to
 * human-readable text; anything unrecognized passes through unchanged —
 * losing the original would hide actionable detail, and this project's own
 * messages are already plain.
 */

const BROWSER_ERROR_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /receiving end does not exist|could not establish connection/i,
    'The page could not be reached — it may have navigated away, shown an error page, or the extension was reloaded.',
  ],
];

const NETWORK_ERROR_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/net::ERR_CONNECTION_REFUSED/i, 'the server refused the connection — is it running?'],
  [/net::ERR_NAME_NOT_RESOLVED/i, 'the server address could not be found'],
  [/net::ERR_CONNECTION_TIMED_OUT/i, 'the server did not respond in time'],
  [/net::ERR_CONNECTION_RESET/i, 'the connection was reset'],
  [/net::ERR_INTERNET_DISCONNECTED/i, 'the device is offline'],
  [/net::ERR_CERT_/i, "the site's security certificate is invalid"],
  [/net::ERR_ABORTED/i, 'the request was aborted'],
];

/** Map a raw browser-runtime error string (e.g. a `tabs.sendMessage` rejection) to plain language. */
export function plainBrowserError(raw: string): string {
  for (const [pattern, text] of BROWSER_ERROR_PATTERNS) {
    if (pattern.test(raw)) return text;
  }
  return raw;
}

/** Map a Chrome network error code (e.g. `webRequest` `details.error`) to plain language. */
export function plainNetworkError(raw: string): string {
  for (const [pattern, text] of NETWORK_ERROR_PATTERNS) {
    if (pattern.test(raw)) return text;
  }
  return raw;
}
