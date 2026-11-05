export type OsvPackageInput = { name: string; version: string; ecosystem: string };
export type OsvAdvisory = {
  id: string;
  aliases: string[];
  summary: string;
  severity_label: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
  fixed_versions: string[];
  published: string | null;
  modified: string | null;
  source_uri: string;
  tier: 'A';
};
export type OsvScanItem = {
  input: string;
  name: string;
  version: string;
  ecosystem: string;
  existence: 'confirmed' | 'not_found' | 'unchecked';
  affected: boolean;
  advisories: OsvAdvisory[];
  note: string | null;
  abstention_reason: null | 'package_not_found';
};
export type OsvScanResult = {
  source: 'OSV';
  queried_at: string;
  items: OsvScanItem[];
  summary: { requested: number; checked: number; affected_packages: number; advisory_count: number; not_found_packages: number; unchecked_packages: number };
};
export type OsvClient = { scan(inputs: readonly (string | OsvPackageInput | { name?: string | undefined; version?: string | undefined; ecosystem?: string | undefined })[], ecosystemDefault?: string | undefined): Promise<OsvScanResult> };

export class OsvUnavailableError extends Error {
  constructor(message = 'OSV advisory source is unavailable.') {
    super(message);
    this.name = 'OsvUnavailableError';
  }
}

type OsvVulnerability = {
  id: string;
  aliases?: unknown;
  summary?: unknown;
  database_specific?: { severity?: unknown };
  severity?: Array<{ type?: unknown; score?: unknown }>;
  affected?: Array<{ ranges?: Array<{ events?: Array<{ fixed?: unknown }> }> }>;
  published?: unknown;
  modified?: unknown;
};

type CacheEntry = { value: unknown; expiresAt: number };
const MAX_CACHE_ENTRIES = 5000;
const DEFAULT_TTL_MS = 10 * 60 * 1000;
const QUERY_TIMEOUT_MS = 10_000;
const EXISTENCE_TIMEOUT_MS = 3_000;
const MAX_CONCURRENCY = 8;
const QUERY_URL = 'https://api.osv.dev/v1/query';
const NO_ADVISORY_NOTE = 'No advisory recorded in OSV for this name and version. This is not a statement that the package is safe.';

type PackageResult = { advisories: OsvAdvisory[]; existence?: OsvScanItem['existence'] };

const parseStringInput = (input: string, ecosystemDefault: string): { parsed?: OsvPackageInput; name: string; version: string; ecosystem: string } => {
  const at = input.lastIndexOf('@');
  if (at < 0 || (at === 0 && !input.slice(1).includes('@'))) return { name: input, version: '', ecosystem: ecosystemDefault };
  if (at === input.length - 1) return { name: input.slice(0, at), version: '', ecosystem: ecosystemDefault };
  const name = input.slice(0, at);
  const version = input.slice(at + 1);
  if (!name || !version) return { name, version, ecosystem: ecosystemDefault };
  return { parsed: { name, version, ecosystem: ecosystemDefault }, name, version, ecosystem: ecosystemDefault };
};

const normalize = (input: string | OsvPackageInput | { name?: string | undefined; version?: string | undefined; ecosystem?: string | undefined }, ecosystemDefault: string): { input: string; package?: OsvPackageInput; name: string; version: string; ecosystem: string } => {
  if (typeof input === 'string') {
    const parsed = parseStringInput(input.trim(), ecosystemDefault);
    return { input, ...(parsed.parsed ? { package: parsed.parsed } : {}), name: parsed.name, version: parsed.version, ecosystem: parsed.ecosystem };
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const version = typeof input.version === 'string' ? input.version.trim() : '';
  const ecosystem = typeof input.ecosystem === 'string' && input.ecosystem.trim() ? input.ecosystem.trim() : ecosystemDefault;
  return {
    input: name && version ? `${name}@${version}` : `${name}${version ? `@${version}` : ''}`,
    ...(name && version ? { package: { name, version, ecosystem } } : {}), name, version, ecosystem,
  };
};

const severityLabel = (vulnerability: OsvVulnerability): OsvAdvisory['severity_label'] => {
  const databaseSeverity = vulnerability.database_specific?.severity;
  if (typeof databaseSeverity === 'string') {
    const normalized = databaseSeverity.trim().toLowerCase();
    if (normalized === 'moderate') return 'medium';
    if (normalized === 'critical' || normalized === 'high' || normalized === 'medium' || normalized === 'low') return normalized;
  }
  for (const severity of vulnerability.severity ?? []) {
    if (severity.type !== 'CVSS_V3') continue;
    if (typeof severity.score !== 'string' && typeof severity.score !== 'number') continue;
    const score = Number(severity.score);
    if (!Number.isFinite(score) || score <= 0) continue;
    if (score >= 9) return 'critical';
    if (score >= 7) return 'high';
    if (score >= 4) return 'medium';
    return 'low';
  }
  return 'unknown';
};

const asString = (value: unknown): string | null => typeof value === 'string' ? value : null;

const toAdvisory = (vulnerability: OsvVulnerability): OsvAdvisory => {
  const fixed = new Set<string>();
  for (const affected of vulnerability.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) if (typeof event.fixed === 'string' && event.fixed) fixed.add(event.fixed);
    }
  }
  return {
    id: vulnerability.id,
    aliases: Array.isArray(vulnerability.aliases) ? [...new Set(vulnerability.aliases.filter((alias): alias is string => typeof alias === 'string'))] : [],
    summary: asString(vulnerability.summary) ?? '',
    severity_label: severityLabel(vulnerability),
    fixed_versions: [...fixed],
    published: asString(vulnerability.published),
    modified: asString(vulnerability.modified),
    source_uri: `https://osv.dev/vulnerability/${encodeURIComponent(vulnerability.id)}`,
    tier: 'A',
  };
};

export const createOsvClient = (options: { fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>; now?: () => number; cacheTtlMs?: number } = {}): OsvClient => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const ttl = options.cacheTtlMs ?? DEFAULT_TTL_MS;
  const cache = new Map<string, CacheEntry>();

  const getCached = <T>(key: string): T | undefined => {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) { cache.delete(key); return undefined; }
    cache.delete(key);
    cache.set(key, entry);
    return entry.value as T;
  };
  const setCached = (key: string, value: unknown): void => {
    cache.delete(key);
    cache.set(key, { value, expiresAt: now() + ttl });
    while (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };
  const requestJson = async (url: string, init: RequestInit | undefined, timeoutMs: number): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal });
      if (!response.ok) throw new OsvUnavailableError(`OSV returned HTTP ${response.status}.`);
      try { return await response.json() as unknown; } catch { throw new OsvUnavailableError('OSV returned invalid JSON.'); }
    } catch (error) {
      if (error instanceof OsvUnavailableError) throw error;
      throw new OsvUnavailableError(error instanceof Error ? error.message : undefined);
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async scan(inputs, ecosystemDefault = 'npm') {
      try {
      const queriedAt = new Date(now()).toISOString();
      const normalized = inputs.map((input) => normalize(input, ecosystemDefault));
      const packageResults = new Map<string, PackageResult>();
      const queries = new Map<string, OsvPackageInput>();
      for (const entry of normalized) {
        if (!entry.package) continue;
        const key = `${entry.package.ecosystem}@${entry.package.name}@${entry.package.version}`;
        const cached = getCached<PackageResult>(`package:${key}`);
        if (cached) packageResults.set(key, cached);
        else queries.set(key, entry.package);
      }

      const pendingQueries = [...queries.entries()];
      let nextQuery = 0;
      const queryWorker = async (): Promise<void> => {
        while (nextQuery < pendingQueries.length) {
          const [key, pkg] = pendingQueries[nextQuery++]!;
          const response = await requestJson(QUERY_URL, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ package: { name: pkg.name, ecosystem: pkg.ecosystem }, version: pkg.version }),
          }, QUERY_TIMEOUT_MS) as { vulns?: OsvVulnerability[] };
          if (!response || (response.vulns !== undefined && !Array.isArray(response.vulns))) throw new OsvUnavailableError('OSV returned an invalid query response.');
          const uniqueVulnerabilities = new Map<string, OsvVulnerability>();
          for (const vulnerability of response.vulns ?? []) {
            if (vulnerability && typeof vulnerability.id === 'string' && vulnerability.id) {
              const previous = getCached<OsvVulnerability>(`vuln:${vulnerability.id}`);
              const detail = previous ?? vulnerability;
              uniqueVulnerabilities.set(detail.id, detail);
              if (!previous) setCached(`vuln:${detail.id}`, detail);
            }
          }
          packageResults.set(key, { advisories: [...uniqueVulnerabilities.values()].map(toAdvisory) });
        }
      };
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, pendingQueries.length) }, () => queryWorker()));

      // Only a zero-advisory OSV result needs an independent package-existence check.
      const checks = new Map<string, { ecosystem: string; name: string }>();
      for (const entry of normalized) {
        if (!entry.package) continue;
        const key = `${entry.package.ecosystem}@${entry.package.name}@${entry.package.version}`;
        const result = packageResults.get(key)!;
        if (result.advisories.length || result.existence) continue;
        const checkKey = `${entry.package.ecosystem}@${entry.package.name}`;
        if (entry.package.ecosystem === 'npm' || entry.package.ecosystem === 'PyPI') checks.set(checkKey, { ecosystem: entry.package.ecosystem, name: entry.package.name });
      }
      const existenceResults = new Map<string, OsvScanItem['existence']>();
      const pendingChecks = [...checks.entries()];
      let nextCheck = 0;
      const existenceWorker = async (): Promise<void> => {
        while (nextCheck < pendingChecks.length) {
          const [key, check] = pendingChecks[nextCheck++]!;
          try {
            const url = check.ecosystem === 'npm'
              ? `https://registry.npmjs.org/${encodeURIComponent(check.name)}`
              : `https://pypi.org/pypi/${encodeURIComponent(check.name)}/json`;
            await requestJson(url, undefined, EXISTENCE_TIMEOUT_MS);
            existenceResults.set(key, 'confirmed');
          } catch (error) {
            existenceResults.set(key, error instanceof OsvUnavailableError && error.message.includes('HTTP 404') ? 'not_found' : 'unchecked');
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, pendingChecks.length) }, () => existenceWorker()));

      const items: OsvScanItem[] = normalized.map((entry) => {
        if (!entry.package) return {
          input: entry.input, name: entry.name, version: entry.version, ecosystem: entry.ecosystem,
          existence: 'unchecked', affected: false, advisories: [], note: null, abstention_reason: 'package_not_found',
        };
        const pkg = entry.package;
        const key = `${pkg.ecosystem}@${pkg.name}@${pkg.version}`;
        const result = packageResults.get(key)!;
        const affected = result.advisories.length > 0;
        const existence = affected ? 'confirmed' : result.existence ?? existenceResults.get(`${pkg.ecosystem}@${pkg.name}`) ?? 'unchecked';
        const completed = { advisories: result.advisories, existence };
        packageResults.set(key, completed);
        setCached(`package:${key}`, existence === 'unchecked' ? { advisories: result.advisories } : completed);
        return { input: entry.input, ...pkg, existence, affected, advisories: result.advisories, note: affected ? null : NO_ADVISORY_NOTE, abstention_reason: null };
      });
      const affectedPackages = items.filter((item) => item.affected).length;
      return {
        source: 'OSV', queried_at: queriedAt, items,
        summary: {
          requested: inputs.length, checked: items.filter((item) => item.abstention_reason === null).length,
          affected_packages: affectedPackages, advisory_count: items.reduce((total, item) => total + item.advisories.length, 0),
          not_found_packages: items.filter((item) => item.existence === 'not_found').length,
          unchecked_packages: items.filter((item) => item.existence === 'unchecked').length,
        },
      };
      } catch (error) {
        if (error instanceof OsvUnavailableError) throw error;
        throw new OsvUnavailableError(error instanceof Error ? error.message : undefined);
      }
    },
  };
};
