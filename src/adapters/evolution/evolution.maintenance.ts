import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { VpsProvider } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { decryptAES256GCM } from '../../common/crypto.util';
import { canonicalEvolutionEndpoint } from '../../prisma/evolution-identity';
import { maintenanceSettings } from '../../modules/maintenance/maintenance.config';
import { parseMaintenanceInventory } from '../../modules/maintenance/maintenance.observation';

export class MaintenanceLogoutError extends Error {
  constructor(
    readonly status: number,
    readonly errorLabel: string | null,
    readonly messageText: string | null,
  ) {
    super(`upstream_${status}`);
  }
}

function boundedLogoutDetail(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { errorLabel: null, messageText: null };
  const record = body as Record<string, unknown>;
  const errorLabel =
    typeof record.error === 'string' && record.error.length <= 40
      ? record.error
      : null;
  const response = record.response;
  const raw =
    response && typeof response === 'object' && !Array.isArray(response)
      ? (response as Record<string, unknown>).message
      : undefined;
  const text = Array.isArray(raw)
    ? raw.length === 1 && typeof raw[0] === 'string'
      ? raw[0]
      : null
    : typeof raw === 'string'
      ? raw
      : null;
  const messageText =
    text && text.length <= 300 && !/base64|data:image/i.test(text)
      ? text
      : null;
  return { errorLabel, messageText };
}

@Injectable()
export class EvolutionMaintenanceClient {
  constructor(private readonly config: ConfigService) {}

  async request(
    provider: VpsProvider,
    method: 'GET' | 'DELETE',
    path: string,
    signal: AbortSignal,
    deadline: number,
  ): Promise<unknown> {
    const url = canonicalEvolutionEndpoint(provider.providerUrl);
    if (!url) throw new Error('provider_identity_invalid');
    const timeout = Math.min(
      maintenanceSettings(this.config).httpTimeout,
      deadline - Date.now(),
    );
    if (signal.aborted || timeout <= 0) throw new Error('deadline');
    try {
      const response = await axios.request<unknown>({
        method,
        url: `${url}${path}`,
        headers: {
          apikey: decryptAES256GCM(
            provider.providerApiKey,
            this.config.getOrThrow<string>('ENCRYPTION_KEY'),
          ),
        },
        timeout,
        signal,
        maxRedirects: 0,
        maxContentLength: 10 * 1024 * 1024,
        maxBodyLength: 0,
        responseType: 'json',
        transitional: { silentJSONParsing: false },
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (!error.response) throw new Error('transport_unconfirmed');
        if (path.startsWith('/instance/logout/')) {
          const detail = boundedLogoutDetail(error.response.data);
          throw new MaintenanceLogoutError(
            error.response.status,
            detail.errorLabel,
            detail.messageText,
          );
        }
        throw new Error(`upstream_${error.response.status}`);
      }
      throw new Error('credential_or_transport_error');
    }
  }

  async inventory(
    provider: VpsProvider,
    signal: AbortSignal,
    deadline: number,
  ) {
    return parseMaintenanceInventory(
      await this.request(
        provider,
        'GET',
        '/instance/fetchInstances',
        signal,
        deadline,
      ),
    );
  }

  async state(
    provider: VpsProvider,
    name: string,
    signal: AbortSignal,
    deadline: number,
  ) {
    const result = (await this.request(
      provider,
      'GET',
      `/instance/connectionState/${encodeURIComponent(name)}`,
      signal,
      deadline,
    )) as { instance?: { instanceName?: string; state?: string } } | null;
    if (
      result?.instance?.instanceName !== name ||
      !['open', 'close', 'connecting'].includes(result.instance.state ?? '')
    )
      throw new Error('state_invalid');
    return result.instance.state!;
  }

  act(
    provider: VpsProvider,
    name: string,
    action: string,
    signal: AbortSignal,
    deadline: number,
  ) {
    return this.request(
      provider,
      'DELETE',
      `/instance/${action === 'delete' ? 'delete' : 'logout'}/${encodeURIComponent(name)}`,
      signal,
      deadline,
    );
  }

  async connect(
    provider: VpsProvider,
    name: string,
    signal: AbortSignal,
    deadline: number,
  ) {
    const value = await this.request(
      provider,
      'GET',
      `/instance/connect/${encodeURIComponent(name)}`,
      signal,
      deadline,
    );
    const rejected =
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      ('error' in value && (value as { error?: unknown }).error !== false);
    if (rejected) throw new Error('connect_rejected');
  }
}
