import assert from "node:assert/strict";
import test from "node:test";

import { getLanIpv4Addresses } from "./dev-network.mjs";

test("getLanIpv4Addresses returns only reachable external IPv4 addresses", () => {
  const addresses = getLanIpv4Addresses({
    Ethernet: [
      { address: "192.168.1.231", family: "IPv4", internal: false },
      { address: "2402:800:6311:f60f::1", family: "IPv6", internal: false },
    ],
    Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    Broken: [{ address: "169.254.10.20", family: 4, internal: false }],
    WiFi: [{ address: "10.0.0.12", family: 4, internal: false }],
  });

  assert.deepEqual(addresses, ["192.168.1.231", "10.0.0.12"]);
});
