export function getLanIpv4Addresses(interfaces) {
  const addresses = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const isIpv4 = entry.family === "IPv4" || entry.family === 4;
      if (!isIpv4 || entry.internal || entry.address.startsWith("169.254.")) continue;
      if (!addresses.includes(entry.address)) addresses.push(entry.address);
    }
  }
  return addresses;
}
