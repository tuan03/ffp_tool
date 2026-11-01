import assert from "node:assert/strict";
import test from "node:test";
import { matchEtsySyncVariants } from "../operations/etsy-variant-matching";

test("Etsy reconciliation matches exact SKUs then legacy source SKUs instead of array position", () => {
  const existing = [{id:"old-m",title:"M",price:"24",sku:"BASE-M"},{id:"old-s",title:"S",price:"24",sku:"BASE-S"}];
  const desired = [{sku:"ETSY-1-S-RED",legacySku:"BASE-S"},{sku:"ETSY-1-M-BLUE",legacySku:"BASE-M"},{sku:"ETSY-1-S-BLUE",legacySku:"BASE-S"}];
  const result = matchEtsySyncVariants(desired, existing, ["old-m","old-s"]);
  assert.equal(result.updates.find(v=>v.variant.sku === "ETSY-1-S-BLUE")?.id,"old-s");
  assert.equal(result.updates.find(v=>v.variant.sku === "ETSY-1-M-BLUE")?.id,"old-m");
  assert.deepEqual(result.creates.map(v=>v.sku),["ETSY-1-S-RED"]);
  assert.deepEqual(result.deletes,[]);
  const repeated = matchEtsySyncVariants([{sku:"ETSY-1-S-RED"},{sku:"ETSY-1-M-BLUE"}],
    [{id:"m",sku:"ETSY-1-M-BLUE",price:"24",title:"M"},{id:"s",sku:"ETSY-1-S-RED",price:"24",title:"S"},{id:"manual",sku:"MANUAL",price:"10",title:"Other"}], ["m","s"]);
  assert.equal(repeated.updates.find(v=>v.variant.sku === "ETSY-1-S-RED")?.id,"s");
  assert.equal(repeated.creates.length,0);
  assert.deepEqual(repeated.deletes,[]);
});
