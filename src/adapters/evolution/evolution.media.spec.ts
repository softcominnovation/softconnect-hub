import { BadGatewayException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaPreparationService } from '../../modules/media/media-preparation.service';
import { EvolutionHttpService } from './evolution.http';
import { EvolutionMediaService } from './evolution.media';

describe('Evolution media batch diagnostic severity', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([201, 502])(
    'uses the correct log level for status %i and preserves cleanup',
    async (status) => {
      const info = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => undefined);
      const error = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const dispose = jest.fn().mockResolvedValue(undefined);
      const preparation = { prepare: jest.fn().mockResolvedValue({ dispose }) };
      const failure = new BadGatewayException('fixture failure');
      const http = {
        requestMedia:
          status === 201
            ? jest.fn().mockResolvedValue({ key: { id: 'fixture' } })
            : jest.fn().mockRejectedValue(failure),
      };
      const service = new EvolutionMediaService(
        new ConfigService({}),
        preparation as unknown as MediaPreparationService,
        http as unknown as EvolutionHttpService,
      );
      const sending = service.send(
        {
          providerUrl: 'https://provider.invalid',
          providerApiKey: 'fixture-secret',
        },
        'fixture-instance',
        { media: 'YWJj', mediatype: 'image' },
        'media',
      );
      if (status === 201)
        await expect(sending).resolves.toEqual({ key: { id: 'fixture' } });
      else await expect(sending).rejects.toBe(failure);
      expect(dispose).toHaveBeenCalledTimes(1);
      const chosen = status === 201 ? info : error;
      const other = status === 201 ? error : info;
      expect(chosen).toHaveBeenCalledTimes(1);
      const entry = String(chosen.mock.calls[0][0]);
      expect(JSON.parse(entry)).toMatchObject({
        event: 'media_request_finished',
        route: 'batch',
        statusCode: status,
        level: status === 201 ? 'INFO' : 'ERROR',
      });
      expect(other).not.toHaveBeenCalled();
      expect(entry).not.toMatch(/fixture-secret|YWJj/);
    },
  );
});
