/**
 * Minimal client for the IBYOK External API.
 *
 * Only `getKeyValue` returns secret material, and only `run` calls it.
 * Everything else is metadata and does not count against quota.
 */

import { ApiError } from './errors';
import { VERSION } from './version';

export const DEFAULT_API_URL = 'https://api.ibyok.com';
export const DASHBOARD_URL = 'https://www.ibyok.com/dashboard';

export type Environment = 'development' | 'staging' | 'production';

export interface ModeInfo {
  environment: Environment;
  effectiveMode: 'mock' | 'live';
  source: string;
}

export interface KeyInfo {
  keyId: string;
  name: string;
  llmType: string;
  modeInfo: ModeInfo;
  lastUsed: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KeyValue {
  keyId: string;
  name: string;
  llmType: string;
  value: string;
  modeInfo: ModeInfo;
}

export interface UsageSummary {
  tier?: string;
  period?: string;
  externalCallsUsed?: number;
  externalCallsLimit?: number;
  mockCallsUsed?: number;
  [key: string]: unknown;
}

/** Normalize user input (dev, stage, prod, ...) to an API environment. */
export function parseEnvironment(input: string): Environment | undefined {
  switch (input.trim().toLowerCase()) {
    case 'dev':
    case 'development':
      return 'development';
    case 'stage':
    case 'staging':
      return 'staging';
    case 'prod':
    case 'production':
      return 'production';
    default:
      return undefined;
  }
}

function describeFailure(status: number, code: string | undefined, message: string | undefined): string {
  switch (code) {
    case 'MISSING_TOKEN':
    case 'INVALID_TOKEN':
      return 'Your IBYOK access token is invalid or expired. Run `ibyok login` with a new token from the dashboard.';
    case 'INSUFFICIENT_SCOPE':
    case 'FORBIDDEN':
      return `${message ?? 'Your token is missing a required scope.'} Create a token with the keys:read scope in the dashboard.`;
    case 'KEY_NOT_FOUND':
      return `${message ?? 'Key not found.'} Run \`ibyok keys\` to see the keys this token can access.`;
    case 'QUOTA_EXCEEDED':
      return `${message ?? 'Monthly live-call quota exceeded.'} Mock-mode calls are not limited. Upgrade at ${DASHBOARD_URL}/billing.`;
  }
  if (status === 401) return 'Your IBYOK access token was rejected. Run `ibyok login` with a new token.';
  if (status === 403) return `${message ?? 'Forbidden.'} Check your token's scopes in the dashboard.`;
  if (status === 429) return message ?? 'Rate limited by IBYOK. Wait a moment and try again.';
  return message ? `IBYOK API error (${status}): ${message}` : `IBYOK API error (HTTP ${status}).`;
}

export class IbyokClient {
  private readonly baseUrl: string;

  constructor(
    private readonly token: string,
    baseUrl: string = DEFAULT_API_URL
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async request<T>(method: 'GET' | 'POST', path: string, query?: Record<string, string | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}/external${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, v);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          'User-Agent': `ibyok-cli/${VERSION}`,
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ApiError(`Could not reach the IBYOK API at ${this.baseUrl} (${reason}).`, 0, 'NETWORK_ERROR');
    }

    const text = await response.text();
    let body: any;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }

    if (!response.ok) {
      const code: string | undefined = body?.code;
      throw new ApiError(describeFailure(response.status, code, body?.message), response.status, code);
    }
    return body as T;
  }

  async listKeys(env?: Environment): Promise<KeyInfo[]> {
    const body = await this.request<{ keys: KeyInfo[] }>('GET', '/keys', { env });
    return body.keys ?? [];
  }

  getKeyValue(keyId: string, env?: Environment): Promise<KeyValue> {
    return this.request<KeyValue>('GET', `/keys/${encodeURIComponent(keyId)}/value`, { env });
  }

  getUsage(): Promise<UsageSummary> {
    return this.request<UsageSummary>('GET', '/usage');
  }
}
