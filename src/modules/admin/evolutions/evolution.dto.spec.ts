import { BadRequestException } from '@nestjs/common';
import {
  allocationSchema,
  catalogQuerySchema,
  createEvolutionSchema,
  EvolutionInputPipe,
  revisionQuerySchema,
  updateEvolutionSchema,
  updateLinkSchema,
} from './evolution.dto';

describe('Evolution administration input contracts', () => {
  it.each([0, -1, 1.5, '', '10', false, 2147483648])(
    'rejects invalid limit %s without coercion',
    (maxInstances) => {
      expect(
        updateEvolutionSchema.safeParse({ expectedRevision: 0, maxInstances })
          .success,
      ).toBe(false);
    },
  );
  it.each([undefined, null, 1, 2147483647])(
    'preserves optional limit %s',
    (maxInstances) => {
      expect(
        updateEvolutionSchema.parse({ expectedRevision: 0, maxInstances })
          .maxInstances,
      ).toBe(maxInstances);
    },
  );
  it.each(['maxInstances', 'providerUrl', 'providerApiKey', 'vpsId', 'mode'])(
    'rejects global field %s on a link',
    (field) => {
      expect(
        updateLinkSchema.safeParse({ expectedRevision: 0, [field]: 'fixture' })
          .success,
      ).toBe(false);
    },
  );
  it('does not require a limit/product or accept controls in create', () => {
    const dto = {
      vpsId: 'vps',
      label: 'Evolution',
      providerUrl: 'https://example.invalid',
      providerApiKey: 'fixture',
    };
    expect(createEvolutionSchema.parse(dto)).toEqual(dto);
    expect(
      createEvolutionSchema.safeParse({ ...dto, maxInstances: 2 }).success,
    ).toBe(false);
    expect(
      createEvolutionSchema.safeParse({ ...dto, productId: 'p' }).success,
    ).toBe(false);
  });
  it.each(['', '   '])(
    'rejects empty credential %s on update',
    (providerApiKey) => {
      expect(
        updateEvolutionSchema.safeParse({ expectedRevision: 0, providerApiKey })
          .success,
      ).toBe(false);
    },
  );
  it.each([
    'https://user:secret@example.invalid',
    'https://example.invalid?token=secret',
    'file:///tmp',
    'bad-url',
  ])('rejects unsafe endpoint %s', (providerUrl) => {
    expect(
      updateEvolutionSchema.safeParse({ expectedRevision: 0, providerUrl })
        .success,
    ).toBe(false);
  });
  it('requires revision and rejects unexpected policy fields', () => {
    expect(allocationSchema.safeParse({ mode: 'capacity' }).success).toBe(
      false,
    );
    expect(
      allocationSchema.safeParse({
        mode: 'legacy',
        expectedRevision: 0,
        maxInstances: 2,
      }).success,
    ).toBe(false);
    expect(
      updateLinkSchema.safeParse({
        expectedRevision: 0,
        allocationPriority: -1,
      }).success,
    ).toBe(false);
  });
  it('parses only explicit boolean filters and integer revision queries', () => {
    expect(catalogQuerySchema.parse({ isActive: 'false' }).isActive).toBe(
      false,
    );
    expect(catalogQuerySchema.parse({})).toEqual({});
    expect(catalogQuerySchema.safeParse({ isActive: 'all' }).success).toBe(
      false,
    );
    expect(
      revisionQuerySchema.parse({ expectedRevision: '2' }).expectedRevision,
    ).toBe(2);
    expect(
      revisionQuerySchema.safeParse({ expectedRevision: '' }).success,
    ).toBe(false);
  });
  it('never echoes invalid credentials from validation errors', () => {
    const pipe = new EvolutionInputPipe(updateEvolutionSchema);
    let error: unknown;
    try {
      pipe.transform({
        providerApiKey: 'secret-marker',
        expectedRevision: 'wrong',
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify(error)).not.toContain('secret-marker');
  });
});
