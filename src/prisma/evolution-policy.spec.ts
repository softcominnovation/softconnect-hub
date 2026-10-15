import { maxInstancesSchema } from './evolution-policy';

describe('Optional Evolution capacity', () => {
  it.each([undefined, null, 1, 100, 2_147_483_647])(
    'preserves valid value %s without inventing a limit',
    (value) => expect(maxInstancesSchema.parse(value)).toBe(value),
  );

  it.each([0, -1, 1.5, '', '10', false, NaN, Infinity, 2_147_483_648])(
    'rejects %s before numeric coercion at the persistence boundary',
    (value) => expect(maxInstancesSchema.safeParse(value).success).toBe(false),
  );
});
