// Compare secrets without returning early on the first different character,
// so response timing does not reveal how much of a guessed token was right.
export function tokensMatch(provided: string, expected: string): boolean {
  if (expected.length === 0) return false;
  let difference = provided.length ^ expected.length;
  for (let index = 0; index < expected.length; index += 1) {
    const providedCode = index < provided.length ? provided.charCodeAt(index) : 0;
    difference |= providedCode ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

// The auth scheme is case-insensitive (RFC 9110), so accept "bearer" too.
export function bearerTokenMatches(header: string | null, expected: string): boolean {
  const match = header?.trim().match(/^bearer +(\S+)$/i);
  return !!match && tokensMatch(match[1], expected);
}
