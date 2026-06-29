/**
 * Anti-noise exclusions (FR-1): hidden inputs and common CSRF/anti-forgery
 * token fields are never recorded, regardless of framework (Laravel `_token`,
 * Rails `authenticity_token`, Django `csrfmiddlewaretoken`, generic `xsrf`).
 */
const CSRF_NAME_PATTERN = /(csrf|xsrf|authenticity[_-]?token|_token)/i;

export function isExcludedField(el: Element): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.type === 'hidden') return true;

  const identifier = `${el.name} ${el.id}`.trim();
  return identifier.length > 0 && CSRF_NAME_PATTERN.test(identifier);
}
