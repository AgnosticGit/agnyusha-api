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

/**
 * Public-facing author/reviewer label: first+last, else email local-part.
 * Returns null when nothing usable is present (caller picks fallback).
 */
export function formatPublicDisplayName(
  parts:
    | {
        firstName?: string | null;
        lastName?: string | null;
        email?: string | null;
      }
    | null
    | undefined,
): string | null {
  if (!parts) return null;
  const name = [parts.firstName, parts.lastName]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  if (name) return name;
  const local = String(parts.email ?? '')
    .split('@')[0]
    ?.trim();
  return local || null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
