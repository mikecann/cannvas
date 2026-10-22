import { v } from "convex/values";
import { deviceAction } from "./fluent";
import { signWallToken } from "./lib/chefWall";

// The wall's sign-in to Chef: its device token for an hour-long auth token
// whose subject is the "cannvas-wall" member (convex/lib/chefWall.ts). The
// Chef sheet's own Convex client asks again before it runs out.
export const token = deviceAction
  .input({})
  .returns(v.object({ token: v.string(), expiresAt: v.number() }))
  .handler(async () => {
    const privateKeyPem = process.env.JWT_PRIVATE_KEY;
    const issuer = process.env.CONVEX_SITE_URL;
    if (!privateKeyPem || !issuer) throw new Error("Chef needs JWT_PRIVATE_KEY (Convex Auth's) on this deployment.");
    return await signWallToken({ privateKeyPem, issuer, now: Date.now() });
  })
  .public();
