import type { SetProxyDto } from '../../providers/whatsapp-provider.interface';

type JsonObject = Record<string, unknown>;

/** Intervals between the (at most three) confirmation reads. */
export const DEFAULT_PROXY_CONFIRM_DELAYS_MS: readonly number[] = [100, 250];

const PUBLIC_PROXY_FIELDS = [
  'enabled',
  'host',
  'port',
  'protocol',
  'username',
] as const;

/** Leaf, `{ instanceName, proxy }` or `{ proxy: { instanceName, proxy } }`. */
const MAX_ENVELOPE_DEPTH = 2;

interface ProxyLeafLocation {
  leaf: JsonObject;
  depth: number;
}

export type ProxyReadOutcome =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'divergent' }
  | { kind: 'confirmed'; leaf: JsonObject };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === 'string';
}

function isValidLeaf(leaf: JsonObject): boolean {
  return (
    typeof leaf.enabled === 'boolean' &&
    isOptionalString(leaf.host) &&
    isOptionalString(leaf.protocol) &&
    isOptionalString(leaf.username) &&
    (isOptionalString(leaf.port) ||
      (typeof leaf.port === 'number' && Number.isFinite(leaf.port)))
  );
}

function locateProxyLeaf(
  body: unknown,
  instanceName: string,
): ProxyLeafLocation | 'empty' | 'invalid' {
  if (body === null || body === undefined || body === '') return 'empty';
  if (!isObject(body)) return 'invalid';
  let current = body;
  for (let depth = 0; depth <= MAX_ENVELOPE_DEPTH; depth++) {
    if ('instanceName' in current && current.instanceName !== instanceName) {
      return 'invalid';
    }
    const next = current.proxy;
    if ('enabled' in current) {
      if (next !== undefined && next !== null) return 'invalid';
      return isValidLeaf(current) ? { leaf: current, depth } : 'invalid';
    }
    if (next === null) return 'empty';
    if (next === undefined) {
      return Object.keys(current).length === 0 ? 'empty' : 'invalid';
    }
    if (!isObject(next)) return 'invalid';
    current = next;
  }
  return 'invalid';
}

function asText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function matchesSentProxy(leaf: JsonObject, sent: SetProxyDto): boolean {
  if (leaf.enabled !== sent.enabled) return false;
  if (!sent.enabled) return true;
  return (
    leaf.host === sent.host &&
    leaf.protocol === sent.protocol &&
    asText(leaf.port) === asText(sent.port) &&
    asText(leaf.username) === asText(sent.username)
  );
}

export function classifyProxyRead(
  body: unknown,
  instanceName: string,
  sent: SetProxyDto,
): ProxyReadOutcome {
  const located = locateProxyLeaf(body, instanceName);
  if (located === 'empty') return { kind: 'empty' };
  if (located === 'invalid') return { kind: 'invalid' };
  return matchesSentProxy(located.leaf, sent)
    ? { kind: 'confirmed', leaf: located.leaf }
    : { kind: 'divergent' };
}

function withoutPasswords(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPasswords);
  if (!isObject(value)) return value;
  const copy: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key !== 'password') copy[key] = withoutPasswords(entry);
  }
  return copy;
}

function replaceLeaf(
  body: JsonObject,
  depth: number,
  leaf: JsonObject,
): JsonObject {
  if (depth === 0) return leaf;
  return {
    ...body,
    proxy: replaceLeaf(body.proxy as JsonObject, depth - 1, leaf),
  };
}

/**
 * Public creation complement: keeps the envelope returned by `/proxy/set`,
 * replaces its leaf with the confirmed public fields and never exposes
 * `password` at any level.
 */
export function buildPublicProxy(
  setBody: unknown,
  confirmed: JsonObject,
  instanceName: string,
): unknown {
  const located = locateProxyLeaf(setBody, instanceName);
  const base: JsonObject =
    typeof located === 'object' ? { ...located.leaf } : {};
  for (const field of PUBLIC_PROXY_FIELDS) {
    if (field in confirmed) base[field] = confirmed[field];
    else delete base[field];
  }
  const envelope =
    typeof located === 'object'
      ? replaceLeaf(setBody as JsonObject, located.depth, base)
      : { proxy: { instanceName, proxy: base } };
  return withoutPasswords(envelope);
}
