/** Pochta Otpravka API returned 404 / missing order for a shipment id. */
export class PochtaEntityNotFoundError extends Error {
  constructor(public readonly orderId: string) {
    super(`Pochta entity not found: ${orderId}`);
    this.name = 'PochtaEntityNotFoundError';
  }
}
