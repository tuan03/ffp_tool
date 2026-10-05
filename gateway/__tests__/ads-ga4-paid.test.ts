import assert from "node:assert/strict";
import test from "node:test";
import { Ga4Client } from "../ads-intelligence/ga4-client";

test("GA4 separates paid Meta from all-source and unverified Meta sessions", async () => {
  const requests: unknown[] = [];
  const client = new Ga4Client({ reportClient: { async runReport(request) {
    requests.push(request);
    const sessions = requests.length === 1 ? "586" : requests.length === 2 ? "41" : "79";
    return [{ rows: [{ metricValues: [{ value: sessions }, { value: "0" }, { value: "0" }] }], metadata: { currencyCode: "USD", timeZone: "America/Chicago" } }];
  } } });
  const report = await client.getOverview("123", "2026-09-05", "2026-10-04");
  assert.equal(report.sessions, 586);
  assert.equal(report.metaPaid?.sessions, 41);
  assert.equal(report.metaPaid?.unverifiedMetaSessions, 79);
  assert.equal(report.metaPaid?.timezone, "America/Chicago");
  const paid = JSON.stringify(requests[1]);
  assert.match(paid, /sessionSource/);
  assert.match(paid, /sessionDefaultChannelGroup/);
  assert.match(paid, /Paid Social/);
  assert.match(JSON.stringify(requests[2]), /notExpression/);
});

test("GA4 paid report failure preserves all-source report without inventing paid zeros", async () => {
  let calls = 0;
  const client = new Ga4Client({ reportClient: { async runReport() {
    if (++calls > 1) throw new Error("fixture unavailable");
    return [{ rows: [{ metricValues: [{value:"586"}, {value:"0"}, {value:"0"}] }], metadata: {currencyCode:"USD"} }];
  } } });
  const report = await client.getOverview("123");
  assert.equal(report.sessions, 586);
  assert.equal(report.metaPaid?.status, "ERROR");
  assert.equal(report.metaPaid?.sessions, null);
});

test("GA4 keeps empty paid reports at zero and retains data-quality warnings", async () => {
  const client = new Ga4Client({ reportClient: { async runReport() {
    return [{ rows: [], metadata: { currencyCode: "USD", timeZone: "America/Chicago", subjectToThresholding: true } }];
  } } });
  const report = await client.getOverview("123");
  assert.equal(report.metaPaid?.status, "AVAILABLE");
  assert.equal(report.metaPaid?.sessions, 0);
  assert.deepEqual(report.metaPaid?.warnings, ["GA4_THRESHOLDING"]);
});
