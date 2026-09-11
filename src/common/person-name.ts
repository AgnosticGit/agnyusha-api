/** Build recipient display name for delivery APIs. */
export function formatPersonName(parts: {
  lastName?: string | null;
  firstName?: string | null;
}): string {
  const name = [parts.lastName, parts.firstName]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  return name || 'Покупатель';
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
