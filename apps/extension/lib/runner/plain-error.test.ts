import { describe, expect, it } from 'vitest';
import { plainBrowserError, plainNetworkError } from './plain-error';

describe('plainBrowserError', () => {
  it('maps the content-script messaging failure to plain language', () => {
    expect(plainBrowserError('Could not establish connection. Receiving end does not exist.')).toBe(
      'The page could not be reached — it may have navigated away, shown an error page, or the extension was reloaded.',
    );
  });

  it('matches case-insensitively', () => {
    expect(plainBrowserError('COULD NOT ESTABLISH CONNECTION')).toBe(
      'The page could not be reached — it may have navigated away, shown an error page, or the extension was reloaded.',
    );
  });

  it('passes unrecognized errors through unchanged', () => {
    const raw = 'Something unexpected happened';
    expect(plainBrowserError(raw)).toBe(raw);
  });
});

describe('plainNetworkError', () => {
  it.each([
    ['net::ERR_CONNECTION_REFUSED', 'the server refused the connection — is it running?'],
    ['net::ERR_NAME_NOT_RESOLVED', 'the server address could not be found'],
    ['net::ERR_CONNECTION_TIMED_OUT', 'the server did not respond in time'],
    ['net::ERR_CONNECTION_RESET', 'the connection was reset'],
    ['net::ERR_INTERNET_DISCONNECTED', 'the device is offline'],
    ['net::ERR_CERT_AUTHORITY_INVALID', "the site's security certificate is invalid"],
    ['net::ERR_ABORTED', 'the request was aborted'],
  ])('maps %s to plain language', (code, expected) => {
    expect(plainNetworkError(code)).toBe(expected);
  });

  it('passes unrecognized network codes through unchanged', () => {
    const raw = 'net::ERR_SOMETHING_NEW';
    expect(plainNetworkError(raw)).toBe(raw);
  });
});
