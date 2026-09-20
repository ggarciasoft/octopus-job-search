/**
 * Locates the server's message for one form control.
 *
 * The API names rejected fields by their path in the request body
 * (`changes.0.value.end_month`, `accepted_fields.2.edited_value.start_month`,
 * `config.match_weights`, `match_weights`). A screen knows its controls by
 * the leaf name only, so the lookup matches the exact key first and then any
 * key that ends in `.<name>`. Everything that matches nothing is still listed
 * verbatim by `ErrorNotice`, so a server message is never silently dropped.
 */
export function fieldError(fields: Readonly<Record<string, string>>, name: string): string | null {
  const exact = fields[name];
  if (typeof exact === 'string') return exact;
  for (const [key, message] of Object.entries(fields)) {
    if (key.endsWith(`.${name}`)) return message;
  }
  return null;
}

/**
 * Strips a request-body prefix so nested fields can be matched by their
 * remaining path (`links.0.url` after `changes.0.value.`).
 */
export function stripFieldPrefix(
  fields: Readonly<Record<string, string>>,
  prefix: RegExp,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, message] of Object.entries(fields)) {
    result[key.replace(prefix, '')] = message;
  }
  return result;
}
