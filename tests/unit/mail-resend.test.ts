import { describe, expect, it, vi } from "vitest";

import { sendViaResend, type FetchLike } from "@/lib/mail/resend";

/**
 * The Resend transport.
 *
 * Tested with a fake `fetch` rather than a mocked module, which is the reason
 * the transport takes one. The property that matters most is the last group:
 * this function must never throw, because its callers have already committed
 * durable work by the time they call it.
 */

const CREDS = { apiKey: "re_test_key", from: "Boardly <invites@example.com>" };

const EMAIL = {
  to: "invitee@example.com",
  subject: "You are invited",
  text: "plain",
  html: "<p>rich</p>",
};

function respondWith(status: number, body: unknown): { fetch: FetchLike; calls: unknown[] } {
  const calls: unknown[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { fetch: fetchImpl, calls };
}

describe("a successful send", () => {
  it("reports delivery and the provider id", async () => {
    const { fetch } = respondWith(200, { id: "abc-123" });
    const result = await sendViaResend(CREDS, EMAIL, fetch);

    expect(result).toEqual({ delivered: true, id: "abc-123" });
  });

  it("posts to Resend with the key and both bodies", async () => {
    const { fetch, calls } = respondWith(200, { id: "x" });
    await sendViaResend(CREDS, EMAIL, fetch);

    const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");

    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      from: CREDS.from,
      to: ["invitee@example.com"],
      subject: "You are invited",
      text: "plain",
      html: "<p>rich</p>",
    });
  });

  it("still reports delivery when the response has no id", async () => {
    const { fetch } = respondWith(200, "not json");
    await expect(sendViaResend(CREDS, EMAIL, fetch)).resolves.toEqual({
      delivered: true,
      id: null,
    });
  });
});

describe("a rejected send", () => {
  it("reports the status and the provider's explanation", async () => {
    // "Domain not verified" and "invalid key" are both 4xx; the body is the
    // only thing that tells an operator which one they are looking at.
    const { fetch } = respondWith(403, { message: "The example.com domain is not verified" });
    const result = await sendViaResend(CREDS, EMAIL, fetch);

    expect(result.delivered).toBe(false);
    if (!result.delivered) {
      expect(result.reason).toContain("403");
      expect(result.reason).toContain("not verified");
    }
  });

  it.each([400, 401, 422, 429, 500])("treats %i as undelivered", async (status) => {
    const { fetch } = respondWith(status, { message: "nope" });
    expect((await sendViaResend(CREDS, EMAIL, fetch)).delivered).toBe(false);
  });
});

describe("never throws", () => {
  it("survives a network failure", async () => {
    const fetchImpl: FetchLike = () => Promise.reject(new Error("ECONNRESET"));

    // The invitation row is already committed when this runs. Throwing here
    // would turn a delivery problem into lost work.
    const result = await sendViaResend(CREDS, EMAIL, fetchImpl);
    expect(result).toEqual({ delivered: false, reason: "ECONNRESET" });
  });

  it("survives a non-Error rejection", async () => {
    const fetchImpl: FetchLike = () => Promise.reject("nope");
    expect((await sendViaResend(CREDS, EMAIL, fetchImpl)).delivered).toBe(false);
  });

  it("gives up rather than hanging forever", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });

      const pending = sendViaResend(CREDS, EMAIL, fetchImpl);
      await vi.advanceTimersByTimeAsync(10_000);

      expect((await pending).delivered).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
