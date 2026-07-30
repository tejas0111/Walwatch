/**
 * Escapes special characters for PostgreSQL LIKE patterns.
 * Prevents LIKE injection by escaping %, _, [, and ] characters.
 */
export function escapeLike(str: string): string {
  return str.replace(/[%_[\]]/g, '\\$&');
}
