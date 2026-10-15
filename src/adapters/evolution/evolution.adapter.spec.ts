import { EvolutionAdapter } from './evolution.adapter';
import { BadRequestException } from '@nestjs/common';
import { EvolutionHttpService } from './evolution.http';
import { QrRequestContext } from '../../common/qr-request-context';

function makeHttp(): jest.Mocked<EvolutionHttpService> {
  return {
    request: jest.fn(),
    createOptionalBudget: jest.fn(),
    tryOptionalRequest: jest.fn(),
    waitOptional: jest.fn(),
    getCircuitState: jest.fn(),
  } as unknown as jest.Mocked<EvolutionHttpService>;
}

const CTX = { providerUrl: 'http://vps.test:8080', providerApiKey: 'test-key' };
const INSTANCE = 'minha-instancia';

describe('EvolutionAdapter', () => {
  let adapter: EvolutionAdapter;
  let http: jest.Mocked<EvolutionHttpService>;

  beforeEach(() => {
    http = makeHttp();
    adapter = new EvolutionAdapter(http);
  });

  describe('Instance methods', () => {
    it('createInstance — delegates to POST /instance/create with dto', async () => {
      const dto = { instanceName: INSTANCE };
      const rawResponse = {
        instance: {
          instanceName: INSTANCE,
          instanceId: 'evo-uuid-1',
          status: 'connecting',
        },
        qrcode: { base64: 'abc123' },
      };
      http.request.mockResolvedValue(rawResponse);

      const result = await adapter.createInstance(CTX, dto);

      expect(http.request).toHaveBeenCalledWith(
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        '/instance/create',
        { ...dto, integration: 'WHATSAPP-BAILEYS' },
        undefined,
        undefined,
      );
      expect(result).toEqual({
        instanceName: INSTANCE,
        instanceId: 'evo-uuid-1',
        status: 'connecting',
        qrcode: { base64: 'abc123' },
      });
    });

    it('createInstance — preserves integration when explicitly provided', async () => {
      const dto = { instanceName: INSTANCE, integration: 'WHATSAPP-BUSINESS' };
      const rawResponse = {
        instance: {
          instanceName: INSTANCE,
          instanceId: 'evo-uuid-2',
          status: 'connecting',
        },
        qrcode: undefined,
      };
      http.request.mockResolvedValue(rawResponse);

      const result = await adapter.createInstance(CTX, dto);

      expect(http.request).toHaveBeenCalledWith(
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        '/instance/create',
        { ...dto, integration: 'WHATSAPP-BUSINESS' },
        undefined,
        undefined,
      );
      expect(result).toEqual({
        instanceName: INSTANCE,
        instanceId: 'evo-uuid-2',
        status: 'connecting',
        qrcode: undefined,
      });
    });

    it('fetchInstances — delegates to GET /instance/fetchInstances and normalizes v1 flat format', async () => {
      const raw = [
        {
          id: 'evo-uuid-1',
          name: INSTANCE,
          connectionStatus: 'open',
          token: 'T1',
        },
      ];
      http.request.mockResolvedValue(raw);

      const result = await adapter.fetchInstances(CTX);

      expect(http.request).toHaveBeenCalledWith(
        'get',
        CTX.providerUrl,
        CTX.providerApiKey,
        '/instance/fetchInstances',
        undefined,
        undefined,
        undefined,
      );
      expect(result[0]).toMatchObject({
        instanceName: INSTANCE,
        id: 'evo-uuid-1',
        status: 'open',
      });
    });

    it('fetchInstances — normalizes v2 Setting format (Setting.instanceId, name → instanceName)', async () => {
      const raw = [
        {
          name: INSTANCE,
          connectionStatus: 'close',
          Setting: { instanceId: 'evo-uuid-setting' },
        },
      ];
      http.request.mockResolvedValue(raw);

      const result = await adapter.fetchInstances(CTX);

      expect(result[0]).toMatchObject({
        instanceName: INSTANCE,
        id: 'evo-uuid-setting',
        status: 'close',
      });
    });

    it('fetchInstances — normalizes v2 nested format (instance.instanceId, instance.instanceName)', async () => {
      const raw = [
        {
          instance: {
            instanceId: 'evo-uuid-nested',
            instanceName: INSTANCE,
            status: 'connecting',
          },
        },
      ];
      http.request.mockResolvedValue(raw);

      const result = await adapter.fetchInstances(CTX);

      expect(result[0]).toMatchObject({
        instanceName: INSTANCE,
        id: 'evo-uuid-nested',
        status: 'connecting',
      });
    });

    it('connectInstance — delegates to GET /instance/connect/:instance', async () => {
      const expected = { pairingCode: '12345678' };
      http.request.mockResolvedValue(expected);

      const result = await adapter.connectInstance(CTX, INSTANCE);

      expect(http.request).toHaveBeenCalledWith(
        'get',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/instance/connect/${INSTANCE}`,
        undefined,
        undefined,
        undefined,
      );
      expect(result).toBe(expected);
    });

    it('getConnectionState — delegates to GET /instance/connectionState/:instance', async () => {
      const expected = { instance: { instanceName: INSTANCE, state: 'open' } };
      http.request.mockResolvedValue(expected);

      const result = await adapter.getConnectionState(CTX, INSTANCE);

      expect(http.request).toHaveBeenCalledWith(
        'get',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/instance/connectionState/${INSTANCE}`,
      );
      expect(result).toBe(expected);
    });

    it('restartInstance — delegates to PUT /instance/restart/:instance', async () => {
      http.request.mockResolvedValue(undefined);
      await adapter.restartInstance(CTX, INSTANCE);
      expect(http.request).toHaveBeenCalledWith(
        'put',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/instance/restart/${INSTANCE}`,
      );
    });

    it('logoutInstance — delegates to DELETE /instance/logout/:instance', async () => {
      http.request.mockResolvedValue(undefined);
      await adapter.logoutInstance(CTX, INSTANCE);
      expect(http.request).toHaveBeenCalledWith(
        'delete',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/instance/logout/${INSTANCE}`,
      );
    });

    it('deleteInstance — delegates to DELETE /instance/delete/:instance', async () => {
      http.request.mockResolvedValue(undefined);
      await adapter.deleteInstance(CTX, INSTANCE);
      expect(http.request).toHaveBeenCalledWith(
        'delete',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/instance/delete/${INSTANCE}`,
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('Message methods', () => {
    const msgResponse = {
      key: {
        id: 'msg-1',
        remoteJid: '5511999998888@s.whatsapp.net',
        fromMe: true,
      },
    };

    it('sendText — delegates to POST /message/sendText/:instance', async () => {
      const dto = { number: '5511999998888', text: 'Olá!' };
      http.request.mockResolvedValue(msgResponse);

      const result = await adapter.sendText(CTX, INSTANCE, dto);

      expect(http.request).toHaveBeenCalledWith(
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/message/sendText/${INSTANCE}`,
        dto,
      );
      expect(result).toBe(msgResponse);
    });

    it('sendMedia — delegates to POST /message/sendMedia/:instance', async () => {
      const dto = {
        number: '5511999998888',
        mediatype: 'image' as const,
        media: 'https://img.test/foto.jpg',
      };
      http.request.mockResolvedValue(msgResponse);

      await adapter.sendMedia(CTX, INSTANCE, dto);

      expect(http.request).toHaveBeenCalledWith(
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/message/sendMedia/${INSTANCE}`,
        dto,
      );
    });

    it('sendDocument — injects mediatype:document and delegates to POST /message/sendMedia/:instance', async () => {
      const dto = {
        number: '5511999998888',
        media: 'https://example.com/doc.pdf',
        fileName: 'doc.pdf',
      };
      http.request.mockResolvedValue(msgResponse);

      await adapter.sendDocument(CTX, INSTANCE, dto);

      expect(http.request).toHaveBeenCalledWith(
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/message/sendMedia/${INSTANCE}`,
        { ...dto, mediatype: 'document' },
      );
    });

    it('sendSticker — delegates to POST /message/sendSticker/:instance', async () => {
      const dto = {
        number: '5511999998888',
        sticker: 'https://example.com/sticker.webp',
      };
      http.request.mockResolvedValue(msgResponse);

      await adapter.sendSticker(CTX, INSTANCE, dto);

      expect(http.request).toHaveBeenCalledWith(
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/message/sendSticker/${INSTANCE}`,
        dto,
      );
    });

    it('sendPresence — delegates to POST /chat/sendPresence/:instance', async () => {
      const dto = { number: '5511999998888', presence: 'composing' as const };
      http.request.mockResolvedValue(undefined);

      await adapter.sendPresence(CTX, INSTANCE, dto);

      expect(http.request).toHaveBeenCalledWith(
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/chat/sendPresence/${INSTANCE}`,
        dto,
      );
    });
  });

  describe('Chat methods', () => {
    it('findChats — delegates to POST /chat/findChats/:instance', async () => {
      http.request.mockResolvedValue([]);
      await adapter.findChats(CTX, INSTANCE, {});
      expect(http.request).toHaveBeenCalledWith(
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/chat/findChats/${INSTANCE}`,
        {},
      );
    });

    it('checkNumber — delegates to POST /chat/whatsappNumbers/:instance', async () => {
      const dto = { numbers: ['5511999998888'] };
      http.request.mockResolvedValue({ exists: true });

      await adapter.checkNumber(CTX, INSTANCE, dto);

      expect(http.request).toHaveBeenCalledWith(
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/chat/whatsappNumbers/${INSTANCE}`,
        dto,
      );
    });
  });

  describe('Webhook methods', () => {
    it('setWebhook — delegates to POST /webhook/set/:instance with byEvents and base64 defaults', async () => {
      const dto = {
        webhook: { enabled: true, url: 'https://n8n.softcom.test/webhook/wh' },
      };
      http.request.mockResolvedValue(undefined);

      await adapter.setWebhook(CTX, INSTANCE, dto);

      expect(http.request).toHaveBeenCalledWith(
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/webhook/set/${INSTANCE}`,
        {
          webhook: {
            enabled: true,
            url: 'https://n8n.softcom.test/webhook/wh',
            byEvents: false,
            base64: true,
          },
        },
        undefined,
        undefined,
      );
    });

    it('findWebhook — delegates to GET /webhook/find/:instance', async () => {
      const expected = {
        webhook: { enabled: true, url: 'https://n8n.softcom.test/webhook/wh' },
      };
      http.request.mockResolvedValue(expected);

      const result = await adapter.findWebhook(CTX, INSTANCE);

      expect(http.request).toHaveBeenCalledWith(
        'get',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/webhook/find/${INSTANCE}`,
      );
      expect(result).toBe(expected);
    });

    it('toggleWebhook — fetches current config and sends correct POST preserving url/events', async () => {
      http.request
        .mockResolvedValueOnce({
          url: 'https://n8n.softcom.test/webhook/wh',
          enabled: true,
          webhookByEvents: true,
          webhookBase64: false,
          events: ['MESSAGES_UPSERT'],
        })
        .mockResolvedValueOnce(undefined);

      await adapter.toggleWebhook(CTX, INSTANCE, { enabled: false });

      expect(http.request).toHaveBeenNthCalledWith(
        1,
        'get',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/webhook/find/${INSTANCE}`,
      );
      expect(http.request).toHaveBeenNthCalledWith(
        2,
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/webhook/set/${INSTANCE}`,
        {
          webhook: {
            enabled: false,
            url: 'https://n8n.softcom.test/webhook/wh',
            events: ['MESSAGES_UPSERT'],
            byEvents: true,
            base64: false,
          },
        },
      );
    });

    it('toggleWebhook — handles response wrapped in webhook key', async () => {
      http.request
        .mockResolvedValueOnce({
          webhook: {
            url: 'https://n8n.softcom.test/webhook/wh',
            enabled: true,
            byEvents: false,
            base64: true,
            events: [],
          },
        })
        .mockResolvedValueOnce(undefined);

      await adapter.toggleWebhook(CTX, INSTANCE, { enabled: true });

      expect(http.request).toHaveBeenNthCalledWith(
        2,
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/webhook/set/${INSTANCE}`,
        {
          webhook: {
            enabled: true,
            url: 'https://n8n.softcom.test/webhook/wh',
            events: [],
            byEvents: false,
            base64: true,
          },
        },
      );
    });
  });

  describe('ProviderContext isolation', () => {
    it('propagates one QR context to both defaults and compensation, only as internal options', async () => {
      const execution = new QrRequestContext(60000, 50000);
      const ctx = { ...CTX, execution };
      const budget = { execution, deadlineAt: 1, callLimitMs: 1 };
      http.request.mockResolvedValue({ enabled: true });
      http.createOptionalBudget.mockReturnValue(budget);
      http.tryOptionalRequest
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({
          data: {
            enabled: true,
            host: 'fixture.invalid',
            port: '8080',
            protocol: 'http',
          },
        });
      await adapter.applyInstanceDefaults(ctx, INSTANCE, {
        webhook: { enabled: true, url: 'https://fixture.invalid/webhook' },
        proxy: {
          enabled: true,
          host: 'fixture.invalid',
          port: '8080',
          protocol: 'http',
        },
      });
      await adapter.deleteInstance(ctx, INSTANCE);
      expect(http.request.mock.calls.map((call) => call[3])).toEqual([
        `/webhook/set/${INSTANCE}`,
        `/instance/delete/${INSTANCE}`,
      ]);
      expect(http.request.mock.calls.map((call) => call[6])).toEqual([
        { execution, operation: 'webhook' },
        { execution, operation: 'delete' },
      ]);
      expect(http.createOptionalBudget).toHaveBeenCalledWith(
        execution,
        undefined,
      );
      expect(http.tryOptionalRequest).toHaveBeenNthCalledWith(
        1,
        budget,
        'post',
        ctx.providerUrl,
        ctx.providerApiKey,
        `/proxy/set/${INSTANCE}`,
        expect.objectContaining({ enabled: true, host: 'fixture.invalid' }),
      );
      expect(http.tryOptionalRequest).toHaveBeenNthCalledWith(
        2,
        budget,
        'get',
        ctx.providerUrl,
        ctx.providerApiKey,
        `/proxy/find/${INSTANCE}`,
      );
      for (const call of http.request.mock.calls) {
        expect(call[5]).toBeUndefined();
        expect(JSON.stringify(call.slice(0, 6))).not.toContain('execution');
      }
    });

    it('keeps explicit proxy configuration on the mandatory HTTP path', async () => {
      const error = new BadRequestException('invalid proxy');
      http.request.mockRejectedValue(error);
      await expect(
        adapter.setProxy(CTX, INSTANCE, {
          enabled: true,
          host: 'fixture.invalid',
          port: '8080',
          protocol: 'http',
        }),
      ).rejects.toBe(error);
      expect(http.tryOptionalRequest).not.toHaveBeenCalled();
    });

    it('preserves a successful webhook when the optional proxy fails', async () => {
      const budget = { deadlineAt: 12345, callLimitMs: 1 };
      http.request.mockResolvedValue({ enabled: true });
      http.createOptionalBudget.mockReturnValue(budget);
      http.tryOptionalRequest.mockResolvedValue({ failure: 'timeout' });
      await expect(
        adapter.applyInstanceDefaults(
          CTX,
          INSTANCE,
          {
            webhook: { url: 'https://fixture.invalid' },
            proxy: { host: 'fixture.invalid', port: '8080', protocol: 'http' },
          },
          { defaultProxyDeadlineAt: 12345 },
        ),
      ).resolves.toEqual({
        webhook: { enabled: true },
        proxyFailure: 'timeout',
        proxyDiagnostics: {
          operation: 'set',
          reads: 0,
          durationMs: expect.any(Number) as unknown,
        },
      });
      expect(http.createOptionalBudget).toHaveBeenCalledWith(undefined, 12345);
      expect(http.tryOptionalRequest).toHaveBeenCalledTimes(1);
      expect(http.tryOptionalRequest).toHaveBeenCalledWith(
        budget,
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/proxy/set/${INSTANCE}`,
        expect.any(Object),
      );
    });

    it('passes different ProviderContext per call without state leakage', async () => {
      const CTX_A = {
        providerUrl: 'http://vps-a.test:8080',
        providerApiKey: 'key-a',
      };
      const CTX_B = {
        providerUrl: 'http://vps-b.test:8080',
        providerApiKey: 'key-b',
      };
      http.request.mockResolvedValue([]);

      await adapter.fetchInstances(CTX_A);
      await adapter.fetchInstances(CTX_B);

      expect(http.request).toHaveBeenNthCalledWith(
        1,
        'get',
        CTX_A.providerUrl,
        CTX_A.providerApiKey,
        '/instance/fetchInstances',
        undefined,
        undefined,
        undefined,
      );
      expect(http.request).toHaveBeenNthCalledWith(
        2,
        'get',
        CTX_B.providerUrl,
        CTX_B.providerApiKey,
        '/instance/fetchInstances',
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('default proxy confirmation', () => {
    const BUDGET = { deadlineAt: 1, callLimitMs: 1 };
    const ACTIVE = {
      enabled: true,
      host: 'proxy.example.invalid',
      port: '80',
      protocol: 'http',
      username: 'fixture-user',
      password: 'fixture-secret',
    };
    const PUBLIC_ACTIVE = {
      enabled: true,
      host: 'proxy.example.invalid',
      port: '80',
      protocol: 'http',
      username: 'fixture-user',
    };
    const DISABLED_ENVELOPE = {
      proxy: {
        instanceName: INSTANCE,
        proxy: {
          enabled: false,
          host: '',
          port: '',
          protocol: '',
          username: '',
          password: '',
        },
      },
    };

    function apply(proxy: Record<string, unknown> = ACTIVE) {
      return adapter.applyInstanceDefaults(
        CTX,
        INSTANCE,
        { proxy: proxy as unknown as typeof ACTIVE },
        { defaultProxyDeadlineAt: 12345 },
      );
    }

    function reads() {
      return http.tryOptionalRequest.mock.calls.filter(
        (call) => call[1] === 'get',
      ).length;
    }

    beforeEach(() => {
      http.createOptionalBudget.mockReturnValue(BUDGET);
      http.waitOptional.mockResolvedValue(true);
    });

    it('replaces an empty set envelope with the confirmed state, without password', async () => {
      http.tryOptionalRequest
        .mockResolvedValueOnce({ data: DISABLED_ENVELOPE })
        .mockResolvedValueOnce({ data: ACTIVE });
      const result = await apply();
      expect(result).toEqual({
        proxy: {
          proxy: { instanceName: INSTANCE, proxy: PUBLIC_ACTIVE },
        },
      });
      expect(JSON.stringify(result)).not.toContain('password');
      expect(http.tryOptionalRequest.mock.calls[0][5]).toMatchObject({
        password: 'fixture-secret',
      });
      expect(reads()).toBe(1);
    });

    it.each([
      [{ ...ACTIVE }, PUBLIC_ACTIVE],
      [
        { instanceName: INSTANCE, proxy: ACTIVE },
        { instanceName: INSTANCE, proxy: PUBLIC_ACTIVE },
      ],
      [null, { proxy: { instanceName: INSTANCE, proxy: PUBLIC_ACTIVE } }],
    ])(
      'keeps the public path of the set envelope %p',
      async (set, expected) => {
        http.tryOptionalRequest
          .mockResolvedValueOnce({ data: set })
          .mockResolvedValueOnce({ data: { proxy: ACTIVE } });
        await expect(apply()).resolves.toEqual({ proxy: expected });
      },
    );

    it('removes password from wrapper levels too', async () => {
      http.tryOptionalRequest
        .mockResolvedValueOnce({
          data: {
            password: 'wrapper-secret',
            proxy: {
              instanceName: INSTANCE,
              password: 'middle-secret',
              proxy: ACTIVE,
            },
          },
        })
        .mockResolvedValueOnce({ data: ACTIVE });
      const result = await apply();
      expect(JSON.stringify(result)).not.toMatch(/secret|password/);
    });

    it('normalizes a numeric port and a missing username', async () => {
      const sent = { ...ACTIVE, username: undefined, password: undefined };
      http.tryOptionalRequest
        .mockResolvedValueOnce({ data: null })
        .mockResolvedValueOnce({
          data: { ...ACTIVE, port: 80, username: null, password: null },
        });
      await expect(apply(sent)).resolves.toEqual({
        proxy: {
          proxy: {
            instanceName: INSTANCE,
            proxy: { ...PUBLIC_ACTIVE, port: 80, username: null },
          },
        },
      });
    });

    it('retries transient empty/404/divergent reads within three reads', async () => {
      http.tryOptionalRequest
        .mockResolvedValueOnce({ data: DISABLED_ENVELOPE })
        .mockResolvedValueOnce({ data: null })
        .mockResolvedValueOnce({ failure: 'upstream_http', status: 404 })
        .mockResolvedValueOnce({ data: ACTIVE });
      await expect(apply()).resolves.toEqual({
        proxy: {
          proxy: { instanceName: INSTANCE, proxy: PUBLIC_ACTIVE },
        },
      });
      expect(http.waitOptional.mock.calls).toEqual([
        [BUDGET, 100],
        [BUDGET, 250],
      ]);
      expect(reads()).toBe(3);
      expect(
        http.tryOptionalRequest.mock.calls.filter((call) => call[1] === 'post'),
      ).toHaveLength(1);
    });

    it('never reports a divergent state as confirmed', async () => {
      http.tryOptionalRequest
        .mockResolvedValueOnce({ data: DISABLED_ENVELOPE })
        .mockResolvedValue({ data: DISABLED_ENVELOPE });
      const result = await apply();
      expect(result).toEqual({
        proxyFailure: 'confirmation_mismatch',
        proxyDiagnostics: {
          operation: 'find',
          reads: 3,
          durationMs: expect.any(Number) as unknown,
        },
      });
      expect(result).not.toHaveProperty('proxy');
    });

    it.each([
      [{ ...ACTIVE, host: 'other.invalid' }, 'confirmation_mismatch', 3],
      [{ proxy: { instanceName: 'other', proxy: ACTIVE } }, 'invalid', 1],
      [{ enabled: 'true', host: 'x' }, 'invalid', 1],
      [{ enabled: true, proxy: ACTIVE }, 'invalid', 1],
      ['unexpected', 'invalid', 1],
    ])('omits proxy for read %p', async (read, reason, expectedReads) => {
      http.tryOptionalRequest
        .mockResolvedValueOnce({ data: ACTIVE })
        .mockResolvedValue({ data: read });
      const result = await apply();
      expect(result).not.toHaveProperty('proxy');
      expect(result.proxyFailure).toBe(
        reason === 'invalid' ? 'confirmation_invalid' : reason,
      );
      expect(reads()).toBe(expectedReads);
    });

    it.each([401, 403, 500])(
      'does not repeat a read rejected with HTTP %s',
      async (status) => {
        http.tryOptionalRequest
          .mockResolvedValueOnce({ data: ACTIVE })
          .mockResolvedValue({ failure: 'upstream_http', status });
        const result = await apply();
        expect(result).toMatchObject({
          proxyFailure: 'upstream_http',
          proxyDiagnostics: { operation: 'find', reads: 1 },
        });
        expect(result).not.toHaveProperty('proxy');
        expect(http.waitOptional).not.toHaveBeenCalled();
      },
    );

    it('stops when the shared budget no longer fits a read or a pause', async () => {
      http.tryOptionalRequest
        .mockResolvedValueOnce({ data: ACTIVE })
        .mockResolvedValueOnce({ data: null });
      http.waitOptional.mockResolvedValue(false);
      await expect(apply()).resolves.toMatchObject({
        proxyFailure: 'confirmation_unavailable',
        proxyDiagnostics: { reads: 1 },
      });
      http.tryOptionalRequest.mockReset();
      http.tryOptionalRequest
        .mockResolvedValueOnce({ data: ACTIVE })
        .mockResolvedValueOnce({ failure: 'budget_exhausted' });
      await expect(apply()).resolves.toMatchObject({
        proxyFailure: 'confirmation_unavailable',
        proxyDiagnostics: { reads: 0 },
      });
    });

    it('keeps an explicitly disabled default and confirms it as such', async () => {
      const disabled = { ...ACTIVE, enabled: false };
      http.tryOptionalRequest
        .mockResolvedValueOnce({ data: DISABLED_ENVELOPE })
        .mockResolvedValueOnce({ data: DISABLED_ENVELOPE.proxy.proxy });
      await expect(apply(disabled)).resolves.toEqual({
        proxy: {
          proxy: {
            instanceName: INSTANCE,
            proxy: {
              enabled: false,
              host: '',
              port: '',
              protocol: '',
              username: '',
            },
          },
        },
      });
      expect(http.tryOptionalRequest.mock.calls[0][5]).toMatchObject({
        enabled: false,
      });
    });

    it('skips the proxy without a finite budget', async () => {
      http.createOptionalBudget.mockReturnValue(undefined);
      await expect(apply()).resolves.toEqual({
        proxyFailure: 'budget_unavailable',
      });
      expect(http.tryOptionalRequest).not.toHaveBeenCalled();
    });
  });
});
