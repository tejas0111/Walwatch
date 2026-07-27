/**
 * Cursor-based Pagination Utility
 *
 * Spec 14 requirement: Every list endpoint uses cursor-based pagination,
 * not offset-based, because offset pagination breaks under concurrent writes.
 *
 * This utility provides helpers for encoding/decoding cursors and wrapping
 * Drizzle ORM queries with cursor-based pagination.
 *
 * Cursor format: base64-encoded JSON `{ id: string, sortValue: string }`
 * The sortValue is the value of the sort field (usually createdAt ISO string).
 */

import { sql, type SQL, type AnyColumn } from 'drizzle-orm';

// ── Types ─────────────────────────────────────────────────────

export interface CursorValue {
  id: string;
  sortValue: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PaginationParams {
  cursor?: string;
  limit: number;
}

// ── Encoding / Decoding ───────────────────────────────────────

/**
 * Encode a cursor value into an opaque string.
 */
export function encodeCursor(id: string, sortValue: string): string {
  return Buffer.from(JSON.stringify({ id, sortValue })).toString('base64url');
}

/**
 * Decode a cursor string into its components.
 * Returns null if the cursor is invalid or malformed.
 */
export function decodeCursor(cursor: string): CursorValue | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.id === 'string' && typeof parsed.sortValue === 'string') {
      return { id: parsed.id, sortValue: parsed.sortValue };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Cursor WHERE clause builder ───────────────────────────────

/**
 * Build a WHERE clause for cursor-based pagination.
 *
 * @param cursor - The decoded cursor (null for first page)
 * @param sortColumn - The column used for sorting (e.g., table.createdAt)
 * @param idColumn - The primary key column (e.g., table.id)
 * @param sortDirection - 'asc' or 'desc'
 * @returns SQL condition for the WHERE clause, or undefined for first page
 *
 * This uses the "keyset pagination" pattern:
 *   WHERE (sortValue > cursor.sortValue) OR
 *         (sortValue = cursor.sortValue AND id > cursor.id)
 *   ORDER BY sortValue [asc|desc], id [asc|desc]
 */
export function buildCursorWhere(
  cursor: CursorValue | null,
  sortColumn: AnyColumn,
  idColumn: AnyColumn,
  sortDirection: 'asc' | 'desc' = 'desc',
): SQL | undefined {
  if (!cursor) return undefined;

  const op = sortDirection === 'asc' ? sql`>` : sql`<`;
  const eqOp = sql`=`;

  return sql`(${sortColumn} ${op} ${cursor.sortValue} OR (${sortColumn} ${eqOp} ${cursor.sortValue} AND ${idColumn} ${op} ${cursor.id}))`;
}

/**
 * Build ORDER BY clause for cursor-based pagination.
 * Always includes the primary key as tiebreaker to ensure stable ordering.
 */
export function buildCursorOrderBy(
  sortColumn: AnyColumn,
  idColumn: AnyColumn,
  sortDirection: 'asc' | 'desc' = 'desc',
): SQL[] {
  return [
    sortDirection === 'asc' ? sql`${sortColumn} ASC` : sql`${sortColumn} DESC`,
    sql`${idColumn} ASC`,
  ];
}

/**
 * Wrap a list of results with pagination metadata.
 * Fetches one extra item to determine if there are more results.
 *
 * @param items - The query results (fetched with limit+1)
 * @param limit - The requested limit
 * @param encodeId - Function to extract the ID from an item
 * @param encodeSortValue - Function to extract the sort value from an item
 * @returns Paginated response with data, nextCursor, and hasMore
 */
export function wrapPaginatedResponse<T extends Record<string, any>>(
  items: T[],
  limit: number,
  encodeId: (item: T) => string,
  encodeSortValue: (item: T) => string,
): PaginatedResponse<T> {
  const hasMore = items.length > limit;
  const data = hasMore ? items.slice(0, limit) : items;

  const nextCursor = hasMore && data.length > 0
    ? encodeCursor(encodeId(data[data.length - 1]), encodeSortValue(data[data.length - 1]))
    : null;

  return { data, nextCursor, hasMore };
}

/**
 * Parse pagination query parameters from a request.
 * Returns cursor (undefined if not provided) and limit.
 */
export function parsePagination(cursor?: string, limitStr?: string): PaginationParams {
  const limit = Math.min(100, Math.max(1, parseInt(limitStr || '50', 10) || 50));
  return { cursor, limit };
}

export default {
  encodeCursor,
  decodeCursor,
  buildCursorWhere,
  buildCursorOrderBy,
  wrapPaginatedResponse,
  parsePagination,
};
