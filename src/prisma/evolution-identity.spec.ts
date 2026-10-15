import { canonicalEvolutionEndpoint } from './evolution-identity';

describe('Evolution endpoint identity', () => {
  it.each([
    ['HTTPS://EVO.EXAMPLE:443/', 'https://evo.example'],
    ['http://evo.example:80/api///', 'http://evo.example/api'],
    ['https://evo.example:8443/API/', 'https://evo.example:8443/API'],
  ])('normalizes %s without changing meaningful paths', (input, expected) => {
    expect(canonicalEvolutionEndpoint(input)).toBe(expected);
  });

  it.each([
    'invalid',
    'ftp://evo.example',
    'https://user:secret@evo.example',
    'https://evo.example/?token=secret',
    'https://evo.example/#fragment',
  ])('leaves unresolved identity for %s', (input) => {
    expect(canonicalEvolutionEndpoint(input)).toBeNull();
  });

  it('does not merge independent paths or hosts on the same VPS', () => {
    expect(canonicalEvolutionEndpoint('https://evo.example/a')).not.toBe(
      canonicalEvolutionEndpoint('https://evo.example/b'),
    );
    expect(canonicalEvolutionEndpoint('https://evo1.example')).not.toBe(
      canonicalEvolutionEndpoint('https://evo2.example'),
    );
  });
});
