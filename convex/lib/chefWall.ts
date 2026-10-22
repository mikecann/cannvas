// Who Chef thinks is calling.
//
// The wall has no signed-in user, but Chef only takes requests from someone it
// can name. So the wall is one Chef member, "cannvas-wall": it trades the
// device token for a short-lived Convex auth token with that subject, signed
// with the deployment's own Convex Auth key (JWT_PRIVATE_KEY), which
// convex/auth.config.ts already trusts.
//
// Mike, the admin, is "mike". No caller can ever be "mike": getUserId only
// answers "cannvas-wall" or null. Mike acts through the email links, whose
// server code passes CHEF_ADMIN_ID to Chef itself.
//
// No Convex imports here, so tests/chefWall.test.mjs can run it in Node.

export const WALL_USER_ID = "cannvas-wall";
export const CHEF_ADMIN_ID = "mike";
export const WALL_TOKEN_TTL_MS = 60 * 60_000;

export function chefUserIdFromIdentity(
  identity: { subject: string; issuer: string } | null,
  siteUrl: string | undefined,
): string | null {
  if (!identity || !siteUrl) return null;
  return identity.issuer === siteUrl && identity.subject === WALL_USER_ID ? WALL_USER_ID : null;
}

function base64url(bytes: Uint8Array | string): string {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (const byte of data) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Convex Auth stores the PKCS#8 PEM with its newlines as spaces.
function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const binary = atob(body);
  const der = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) der[index] = binary.charCodeAt(index);
  return der;
}

export async function signWallToken(options: { privateKeyPem: string; issuer: string; now: number }): Promise<{ token: string; expiresAt: number }> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(options.privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const issuedAt = Math.floor(options.now / 1000);
  const expiresAt = options.now + WALL_TOKEN_TTL_MS;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    sub: WALL_USER_ID,
    iss: options.issuer,
    aud: "convex",
    iat: issuedAt,
    exp: Math.floor(expiresAt / 1000),
  }));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  return { token: `${header}.${payload}.${base64url(new Uint8Array(signature))}`, expiresAt };
}
