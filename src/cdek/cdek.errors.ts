/** CDEK API returned 404 / v2_entity_not_found for an order uuid. */
export class CdekEntityNotFoundError extends Error {
  constructor(public readonly uuid: string) {
    super(`CDEK entity not found: ${uuid}`);
    this.name = 'CdekEntityNotFoundError';
  }
}
