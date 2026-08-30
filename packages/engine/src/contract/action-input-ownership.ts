const INPUT_OWNER = 'x-ui4a-input-owner';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNoNestedOwnership(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoNestedOwnership(entry, `${path}[${index}]`));
    return;
  }
  if (!record(value)) return;
  if (Object.prototype.hasOwnProperty.call(value, INPUT_OWNER)) {
    throw new Error(`${INPUT_OWNER} is allowed only on a top-level action property (${path})`);
  }
  for (const [key, entry] of Object.entries(value)) {
    assertNoNestedOwnership(entry, `${path}.${key}`);
  }
}

/**
 * Derive the one caller-visible schema from a public full action schema.
 *
 * A top-level property is caller-owned by default. The only wire annotation is
 * `x-ui4a-input-owner: client`; those properties and their required entries are removed. The
 * source schema is never mutated.
 */
export function callerActionSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (Object.prototype.hasOwnProperty.call(schema, INPUT_OWNER)) {
    throw new Error(`${INPUT_OWNER} is allowed only on a top-level action property`);
  }
  const rawProperties = schema.properties;
  if (rawProperties !== undefined && !record(rawProperties)) {
    throw new Error('action schema properties must be an object');
  }
  const properties: Record<string, unknown> = {};
  const clientNames = new Set<string>();
  for (const [name, value] of Object.entries(rawProperties ?? {})) {
    if (!record(value)) {
      properties[name] = value;
      continue;
    }
    const owner = value[INPUT_OWNER];
    if (owner !== undefined && owner !== 'client') {
      throw new Error(`${INPUT_OWNER} permits only the client literal (property ${name})`);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key !== INPUT_OWNER) assertNoNestedOwnership(entry, `properties.${name}.${key}`);
    }
    if (owner === 'client') clientNames.add(name);
    else properties[name] = value;
  }
  const required = Array.isArray(schema.required)
    ? schema.required.filter(
        (entry): entry is string => typeof entry === 'string' && !clientNames.has(entry),
      )
    : schema.required;
  return {
    ...schema,
    ...(rawProperties === undefined ? {} : { properties }),
    ...(required === undefined ? {} : { required }),
  };
}

/** Names explicitly owned by the trusted client host. */
export function clientActionPropertyNames(schema: Record<string, unknown>): string[] {
  // Run the strict annotation validation once before returning the names.
  callerActionSchema(schema);
  const properties = record(schema.properties) ? schema.properties : {};
  return Object.entries(properties)
    .filter(([, value]) => record(value) && value[INPUT_OWNER] === 'client')
    .map(([name]) => name);
}
