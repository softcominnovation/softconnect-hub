import { EvolutionAdapter } from './evolution.adapter';
import { EvolutionHttpService } from './evolution.http';

function makeHttp(): jest.Mocked<EvolutionHttpService> {
  return {
    request: jest.fn(),
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
    it('setWebhook — delegates to POST /webhook/set/:instance', async () => {
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
        dto,
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
  });

  describe('ProviderContext isolation', () => {
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
      );
      expect(http.request).toHaveBeenNthCalledWith(
        2,
        'get',
        CTX_B.providerUrl,
        CTX_B.providerApiKey,
        '/instance/fetchInstances',
      );
    });
  });
});
