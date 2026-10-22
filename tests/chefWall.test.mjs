import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { CHEF_ADMIN_ID, chefUserIdFromIdentity, signWallToken, WALL_USER_ID, WALL_TOKEN_TTL_MS } from "../convex/lib/chefWall.ts";

const SITE = "https://flippant-sheep-839.convex.site";

test("only the wall's own token makes a Chef user, and never the admin", () => {
  assert.equal(chefUserIdFromIdentity({ subject: WALL_USER_ID, issuer: SITE }, SITE), WALL_USER_ID);
  assert.equal(chefUserIdFromIdentity(null, SITE), null);
  // A Convex Auth user (inventory) is signed out to Chef.
  assert.equal(chefUserIdFromIdentity({ subject: "k57user|k57session", issuer: SITE }, SITE), null);
  // The admin's id, or the wall's from another issuer, is nobody.
  assert.equal(chefUserIdFromIdentity({ subject: CHEF_ADMIN_ID, issuer: SITE }, SITE), null);
  assert.equal(chefUserIdFromIdentity({ subject: WALL_USER_ID, issuer: "https://evil.example" }, SITE), null);
  assert.equal(chefUserIdFromIdentity({ subject: WALL_USER_ID, issuer: SITE }, undefined), null);
});

test("the wall's token is an RS256 JWT Convex Auth's key signed", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  // As Convex Auth stores it: the PEM's newlines as spaces.
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim().replace(/\n/g, " ");
  const now = 1_800_000_000_000;
  const { token, expiresAt } = await signWallToken({ privateKeyPem: pem, issuer: SITE, now });
  assert.equal(expiresAt, now + WALL_TOKEN_TTL_MS);

  const [header, payload, signature] = token.split(".");
  const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString());
  assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(decode(payload), { sub: WALL_USER_ID, iss: SITE, aud: "convex", iat: now / 1000, exp: (now + WALL_TOKEN_TTL_MS) / 1000 });
  assert.equal(
    verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")),
    true,
  );
});
