import { generatePickupSlots, DEFAULT_PICKUP_SETTINGS } from '../../src/pickup/pickup.util';

/** First bookable store-pickup slot for e2e order payloads. */
export function testStorePickupAt(now = new Date()): string {
  const slots = generatePickupSlots(DEFAULT_PICKUP_SETTINGS, {
    now,
    daysAhead: 21,
  });
  if (!slots[0]) {
    throw new Error('No pickup slots available for test');
  }
  return slots[0].at;
}
