export type ParsedOzonNotification = {
  /** Our order id (createOrder extId), when present. */
  extId: string | null;
  /** Ozon payment/order id. */
  ozonId: string | null;
  status: string | null;
  /** Top-level / nested keys seen (for diagnostics). */
  keys: string[];
};

/**
 * Our merchant order id (createOrder `extId`).
 * Do NOT include bare `orderID` — in real Ozon notifications that is Ozon's id.
 */
const EXT_ID_KEYS = new Set([
  'extid',
  'ext_id',
  'extorderid',
  'ext_order_id',
  'externalid',
  'external_id',
  'externalorderid',
  'external_order_id',
  'merchantorderid',
  'merchant_order_id',
]);

/** Ozon-side identifiers (createOrder response `order.id`, webhook `orderID`, …). */
const OZON_ID_KEYS = new Set([
  'id',
  'orderid',
  'order_id',
  'ozonid',
  'ozon_id',
  'ozonorderid',
  'ozon_order_id',
  'paymentid',
  'payment_id',
  'transactionid',
  'transaction_id',
  'transactionuid',
  'transaction_uid',
  'orderuuid',
  'order_uuid',
]);

const STATUS_KEYS = new Set([
  'status',
  'orderstatus',
  'order_status',
  'paymentstatus',
  'payment_status',
  'operationtype',
  'operation_type',
  'state',
]);

const NEST_KEYS = [
  'order',
  'item',
  'data',
  'payload',
  'notification',
  'result',
  'body',
  'message',
] as const;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

export function asOzonFieldString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function collectObjects(body: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 4) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 8)) visit(item, depth + 1);
      return;
    }
    const obj = value as Record<string, unknown>;
    out.push(obj);
    for (const key of NEST_KEYS) {
      if (key in obj) visit(obj[key], depth + 1);
    }
  };
  visit(body, 0);
  return out;
}

/**
 * Best-effort parse of Ozon Pay notification bodies.
 * Real bank notifications use `extOrderID` (ours) + `orderID` (theirs) + `status`.
 */
export function parseOzonNotification(body: unknown): ParsedOzonNotification {
  let root: unknown = body;
  if (typeof body === 'string') {
    const trimmed = body.trim();
    if (!trimmed) {
      return { extId: null, ozonId: null, status: null, keys: [] };
    }
    try {
      root = JSON.parse(trimmed) as unknown;
    } catch {
      return { extId: null, ozonId: null, status: null, keys: [] };
    }
  }

  const objects = collectObjects(root);
  let extId: string | null = null;
  let ozonId: string | null = null;
  let status: string | null = null;
  const keys: string[] = [];

  // Prefer explicit merchant id fields first (extOrderID before generic id).
  for (const obj of objects) {
    for (const [key, value] of Object.entries(obj)) {
      keys.push(key);
      const nk = normalizeKey(key);
      const str = asOzonFieldString(value);
      if (!str) continue;
      if (!extId && EXT_ID_KEYS.has(nk)) extId = str;
    }
  }

  for (const obj of objects) {
    for (const [key, value] of Object.entries(obj)) {
      const nk = normalizeKey(key);
      const str = asOzonFieldString(value);
      if (!str) continue;
      if (!status && STATUS_KEYS.has(nk)) {
        // Prefer payment status over operationType when both exist.
        if (nk === 'status' || nk === 'orderstatus' || nk === 'paymentstatus') {
          status = str;
        } else if (!status) {
          status = str;
        }
      }
      if (!ozonId && OZON_ID_KEYS.has(nk) && str !== extId) {
        // Prefer orderID over transaction* when both present.
        if (nk === 'orderid' || nk === 'id') {
          ozonId = str;
        } else if (!ozonId) {
          ozonId = str;
        }
      }
    }
  }

  // Second pass: if status was overwritten by operationType, restore `status`.
  for (const obj of objects) {
    const direct =
      asOzonFieldString(obj.status) ??
      asOzonFieldString(obj.Status) ??
      asOzonFieldString(obj.orderStatus);
    if (direct) {
      status = direct;
      break;
    }
  }

  // Prefer orderID as ozonId when both orderID and transactionID exist.
  for (const obj of objects) {
    const orderId =
      asOzonFieldString(obj.orderID) ??
      asOzonFieldString(obj.orderId) ??
      asOzonFieldString(obj.OrderID);
    if (orderId && orderId !== extId) {
      ozonId = orderId;
      break;
    }
  }

  return {
    extId,
    ozonId,
    status,
    keys: [...new Set(keys)].slice(0, 40),
  };
}
