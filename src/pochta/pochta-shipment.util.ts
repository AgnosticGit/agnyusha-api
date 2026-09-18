/** Otpravka shipment/backlog ids come from numeric `result-ids`. */
export function isPochtaShipmentId(id: string): boolean {
  return /^\d{1,20}$/.test(id.trim());
}

export function isPochtaShipmentLookupPath(path: string): boolean {
  return /(?:^|\/)1\.0\/(?:shipment|backlog)\//i.test(path);
}

/** 404, or 400 BAD_REQUEST on junk ids (Otpravka often rejects instead of 404). */
export function isPochtaMissingEntityResponse(
  status: number,
  body: string,
): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  const lower = body.toLowerCase();
  return (
    lower.includes('bad_request') ||
    lower.includes('invalid request') ||
    lower.includes('not found')
  );
}
