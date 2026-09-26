import assert from "node:assert/strict";
import test from "node:test";

import { UnofficialGoogleSuggestClient } from "../internal/search-suggestions/google-suggest-client";
import { GoogleSearchSuggestionsCollector } from "../internal/search-suggestions/google-search-suggestions-collector";
import { GoogleSuggestBlockedError } from "../internal/search-suggestions/search-suggestion-errors";

test("Stop aborts the actual Suggest fetch while its response body is still being read", async () => {
  let fetchSignal: AbortSignal | null | undefined;
  let markReading: (() => void) | undefined;
  let finishBody: (() => void) | undefined;
  const reading = new Promise<void>(resolve => { markReading = resolve; });
  const client = new UnofficialGoogleSuggestClient({ fetchFn: async (_url, init) => {
    fetchSignal = init?.signal;
    const response = new Response();
    response.json = async () => {
      markReading?.();
      await new Promise<void>(resolve => { finishBody = resolve; });
      return ["rug", ["round rug"]];
    };
    return response;
  } });
  const controller = new AbortController();
  const pending = client.getSuggestions("rug", { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await reading;
  controller.abort();
  await rejected;
  const wasFetchAborted = fetchSignal?.aborted;
  finishBody?.();
  assert.equal(wasFetchAborted, true);
});

test("identical Suggest requests share work and cancelling one subscriber preserves the other", async () => {
  let calls = 0;
  let finish: (() => void) | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  let fetchSignal: AbortSignal | null | undefined;
  const client = new UnofficialGoogleSuggestClient({ fetchFn: async (_url, init) => {
    calls++;
    fetchSignal = init?.signal;
    markStarted?.();
    await new Promise<void>(resolve => { finish = resolve; });
    return new Response(JSON.stringify(["rug", ["rug for bedroom"]]));
  } });
  const controller = new AbortController();
  const first = client.getSuggestions("rug", { signal: controller.signal });
  const rejected = assert.rejects(first, { name: "AbortError" });
  const second = client.getSuggestions("rug");
  await started;
  controller.abort();
  finish?.();
  await rejected;
  assert.deepEqual(await second, ["rug for bedroom"]);
  assert.equal(calls, 1);
  assert.equal(fetchSignal?.aborted, false);
  assert.deepEqual(await client.getSuggestions("rug"), ["rug for bedroom"]);
  assert.equal(calls, 1);
});

test("parallel Suggest completion preserves sequential priority, limits and provenance", async () => {
  const input = { source: {}, shoppingContext: {
    targetAudience: [], suitableOccasions: [], useCases: [],
    buyerIntentKeywords: ["cat mug", "dog mug", "bird mug"],
  } };
  const suggestions = (query: string) => ["shared ceramic mug", ...Array.from({ length: 20 }, (_, i) => `${query} design ${i}`)];
  const sequential = await new GoogleSearchSuggestionsCollector({ interRequestDelayMs: 0,
    client: { async getSuggestions(query) { return suggestions(query); } },
  }).collect(input);
  const releases = new Map<string, () => void>();
  const pending = new GoogleSearchSuggestionsCollector({ interRequestDelayMs: 0, concurrency: 3,
    client: { async getSuggestions(query) {
      await new Promise<void>(resolve => releases.set(query, resolve));
      return suggestions(query);
    } },
  }).collect(input);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releases.size, 3);
  [...releases.values()].reverse().forEach(release => release());
  assert.deepEqual(await pending, sequential);
});

test("parallel Suggest stops scheduling after a block and never caches an error", async () => {
  let calls = 0;
  const client = new UnofficialGoogleSuggestClient({ fetchFn: async () => {
    calls++;
    return calls === 1 ? new Response("blocked", { status: 403 }) : new Response('["mug",["ceramic mug"]]');
  } });
  await assert.rejects(client.getSuggestions("mug"), GoogleSuggestBlockedError);
  assert.deepEqual(await client.getSuggestions("mug"), ["ceramic mug"]);
  assert.equal(calls, 2);
  let probes = 0;
  await new GoogleSearchSuggestionsCollector({ concurrency: 3, interRequestDelayMs: 0,
    onPartialFailure() {}, client: { async getSuggestions() { probes++; throw new GoogleSuggestBlockedError("blocked"); } },
  }).collect({ source: {}, shoppingContext: { targetAudience: [], suitableOccasions: [], useCases: [],
    buyerIntentKeywords: ["cat mug", "dog mug", "bird mug", "mouse mug", "horse mug"],
  } });
  assert.equal(probes, 3);
});

test("Suggest rejects an already cancelled request even when cached", async () => {
  const client = new UnofficialGoogleSuggestClient({ fetchFn: async () => new Response('["rug",["round rug"]]') });
  await client.getSuggestions("rug");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.getSuggestions("rug", { signal: controller.signal }), { name: "AbortError" });
});
