import type { InstanceDto } from '../../providers/whatsapp-provider.interface';
import { withInstanceNumber } from './instance-number';

const PHONE = '5511999990000';
const JID = `${PHONE}@s.whatsapp.net`;
const instance = (fields: Record<string, unknown>): InstanceDto => ({
  instanceName: 'number-fixture',
  status: 'open',
  ...fields,
});

describe('Instance query number', () => {
  it.each([
    {},
    { number: undefined },
    { number: null },
    { number: '' },
    { number: '  \t' },
  ])('fills an empty number without changing other fields: %p', (fields) => {
    const input = Object.freeze(
      instance({
        ...fields,
        ownerJid: JID,
        id: 'provider-id',
        hubId: 'hub-id',
        Proxy: Object.freeze({ enabled: false }),
        Setting: Object.freeze({ readMessages: false }),
      }),
    );
    const before = { ...input };
    const result = withInstanceNumber(input, 'evolution');
    expect(result).toStrictEqual({ ...before, number: PHONE });
    expect(input).toStrictEqual(before);
    expect(result).not.toBe(input);
    expect(result.Proxy).toBe(input.Proxy);
    expect(withInstanceNumber(result, 'evolution')).toStrictEqual(result);
  });

  it.each([PHONE, '+1 (555) 123-4567', ' 5511000000000 ', 0, false, {}, []])(
    'preserves any nonempty value exactly: %p',
    (number) => {
      const input = instance({ number, ownerJid: JID });
      expect(withInstanceNumber(input, 'evolution')).toBe(input);
    },
  );

  it.each([
    undefined,
    null,
    123,
    {},
    [],
    '',
    '5511999990000',
    '@s.whatsapp.net',
    `${PHONE}@lid`,
    `${PHONE}@g.us`,
    `${PHONE}@broadcast`,
    `${PHONE}:12@s.whatsapp.net`,
    `+${JID}`,
    ` ${JID}`,
    `${JID} `,
    `${JID}\n`,
    `${JID}\r\n`,
    `${JID}\u2028`,
    `${JID}\u2029`,
    `${PHONE}@s.whatsapp.net.invalid`,
    `prefix${JID}`,
    '５５１１９９９９９００００@s.whatsapp.net',
  ])(
    'leaves the original empty/missing value for an unrecognized JID: %p',
    (ownerJid) => {
      for (const fields of [
        {},
        { number: undefined },
        { number: null },
        { number: '' },
        { number: ' ' },
      ]) {
        const input = instance({ ...fields, ownerJid });
        expect(withInstanceNumber(input, 'evolution')).toBe(input);
      }
    },
  );

  it('does not derive from nested fields or unrelated identifiers', () => {
    const input = instance({
      instanceName: PHONE,
      owner: JID,
      token: PHONE,
      instance: { number: null, ownerJid: JID },
      Setting: { ownerJid: JID },
    });
    expect(withInstanceNumber(input, 'evolution')).toBe(input);
    expect(input).not.toHaveProperty('number');
  });

  it('keeps digits as a string without rounding, masking or adding digits', () => {
    const digits = '00012345678901234567890';
    expect(
      withInstanceNumber(
        instance({ ownerJid: `${digits}@s.whatsapp.net` }),
        'evolution',
      ).number,
    ).toBe(digits);
  });

  it.each(['open', 'close', 'connecting', 'disconnected'])(
    'does not change connection state %s',
    (status) => {
      const input = instance({
        status,
        connectionStatus: status,
        ownerJid: JID,
        number: null,
      });
      expect(withInstanceNumber(input, 'evolution')).toStrictEqual({
        ...input,
        number: PHONE,
      });
    },
  );

  it('leaves another adapter untouched', () => {
    const input = instance({ number: null, ownerJid: JID });
    expect(withInstanceNumber(input, 'fixture-other')).toBe(input);
  });
});
