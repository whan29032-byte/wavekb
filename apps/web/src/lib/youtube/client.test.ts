import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeYoutube } from "./client";
import { youtubePolicyVersion, type YoutubeAuthorizationOptions } from "./contracts";

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
describe("YouTube client policy boundary", () => {
  it.each([{}, { privacyTermsAccepted: false, policyVersion: youtubePolicyVersion }, { privacyTermsAccepted: true, policyVersion: "previous" }])("does not send a request without current explicit consent: %j", async (consent) => {
    await expect(authorizeYoutube({ importHistory: true, autoSync: false, ...consent } as YoutubeAuthorizationOptions)).rejects.toThrow("youtube_policy_consent_required");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends only the current consent and choices, not an acceptance time from the client", async () => {
    const state = "a".repeat(43);
    const authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&scope=${encodeURIComponent("https://www.googleapis.com/auth/youtube.readonly")}&state=${state}`;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ authorizationUrl })));
    const input: YoutubeAuthorizationOptions = { importHistory: true, autoSync: false, privacyTermsAccepted: true, policyVersion: youtubePolicyVersion };
    expect(await authorizeYoutube(input)).toBe(authorizationUrl);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/youtube/authorize");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });
});
