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
      const expected = { instanceName: INSTANCE, status: 'open' };
      http.request.mockResolvedValue(expected);

      const result = await adapter.createInstance(CTX, dto);

      expect(http.request).toHaveBeenCalledWith(
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        '/instance/create',
        dto,
      );
      expect(result).toBe(expected);
    });

    it('fetchInstances — delegates to GET /instance/fetchInstances', async () => {
      const expected = [{ instanceName: INSTANCE, status: 'open' }];
      http.request.mockResolvedValue(expected);

      const result = await adapter.fetchInstances(CTX);

      expect(http.request).toHaveBeenCalledWith(
        'get',
        CTX.providerUrl,
        CTX.providerApiKey,
        '/instance/fetchInstances',
      );
      expect(result).toBe(expected);
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

    it('sendWhatsAppAudio — delegates to POST /message/sendWhatsAppAudio/:instance', async () => {
      const dto = {
        number: '5511999998888',
        audio: 'data:audio/ogg;base64,abc123',
      };
      http.request.mockResolvedValue(msgResponse);

      await adapter.sendWhatsAppAudio(CTX, INSTANCE, dto);

      expect(http.request).toHaveBeenCalledWith(
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/message/sendWhatsAppAudio/${INSTANCE}`,
        dto,
      );
    });

    it('sendReaction — delegates to POST /message/sendReaction/:instance', async () => {
      const dto = {
        key: { id: 'msg-1', remoteJid: '5511@s.whatsapp.net', fromMe: true },
        reaction: '❤️',
      };
      http.request.mockResolvedValue(msgResponse);

      await adapter.sendReaction(CTX, INSTANCE, dto);

      expect(http.request).toHaveBeenCalledWith(
        'post',
        CTX.providerUrl,
        CTX.providerApiKey,
        `/message/sendReaction/${INSTANCE}`,
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
      const dto = { url: 'https://n8n.softcom.test/webhook/wh' };
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
        enabled: true,
        url: 'https://n8n.softcom.test/webhook/wh',
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
