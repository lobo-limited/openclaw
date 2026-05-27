import { describe, it, expect, beforeEach } from "vitest";
import { verifyAccessJwt, _resetCacheForTest } from "../../src/lib/auth/access";

beforeEach(() => {
  _resetCacheForTest();
});

describe("verifyAccessJwt", () => {
  it("rejects malformed tokens", async () => {
    process.env.ACCESS_TEAM_DOMAIN = "handsomegato.cloudflareaccess.com";
    process.env.ACCESS_AUD = "test-aud";
    await expect(verifyAccessJwt("not-a-jwt")).rejects.toThrow();
  });

  it("throws when ACCESS_TEAM_DOMAIN is missing", async () => {
    const oldDomain = process.env.ACCESS_TEAM_DOMAIN;
    const oldAud = process.env.ACCESS_AUD;
    delete process.env.ACCESS_TEAM_DOMAIN;
    process.env.ACCESS_AUD = "test-aud";
    await expect(verifyAccessJwt("a.b.c")).rejects.toThrow(/ACCESS_TEAM_DOMAIN/);
    if (oldDomain) process.env.ACCESS_TEAM_DOMAIN = oldDomain;
    if (oldAud) process.env.ACCESS_AUD = oldAud;
  });

  it("rejects token with wrong audience", async () => {
    process.env.ACCESS_TEAM_DOMAIN = "handsomegato.cloudflareaccess.com";
    process.env.ACCESS_AUD = "test-aud";
    await expect(verifyAccessJwt("e30.e30.fake")).rejects.toThrow();
  });
});
