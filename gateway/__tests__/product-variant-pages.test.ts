import assert from "node:assert/strict";
import test from "node:test";
import { readAllProductVariants } from "../operations/product-variant-pages";
import { executeProductsGet } from "../operations/products";
import { InMemoryThrottleManager, ShopifyGraphqlClient, StaticAccessTokenProvider } from "../index";
import type { StoreConfig } from "../types";
const store: StoreConfig = { storeId: "test", shopDomain: "example.myshopify.com", apiVersion: "2026-07", auth: { type: "static", staticToken: "fixture" } };
test("Product reconciliation reads all 288 variants and rejects broken pagination", async () => {
  const client = { async query<T>(_store: StoreConfig, _query: string, variables?: Record<string, unknown>): Promise<T> {
    const second = Boolean(variables?.after);
    return { product: { variants: { nodes: Array.from({length: second ? 38 : 250}, (_, i) => ({id: `variant-${i + (second ? 250 : 0)}`, sku: `SKU-${i}`, price: "24.00", title: "Test"})),
      pageInfo: { hasNextPage: !second, endCursor: second ? null : "next" } } } } as T;
  } };
  assert.equal((await readAllProductVariants(store, client, "product-1")).length, 288);
  const broken = { async query<T>(): Promise<T> { return {product:{variants:{nodes:[],pageInfo:{hasNextPage:true,endCursor:null}}}} as T; } };
  await assert.rejects(readAllProductVariants(store, broken, "product-1"), /pagination/i);
});

test("products.get preserves catalog sampling by default and reads every variant when sync requests it", async () => {
  let pageReads = 0;
  const client = new ShopifyGraphqlClient({tokenProvider:new StaticAccessTokenProvider(),throttleManager:new InMemoryThrottleManager(),baseTransport:async(_url,init)=>{
    const body=JSON.parse(String(init?.body)) as {query:string};
    const variant={id:"variant-1",title:"M",price:"24.00"};
    let response:unknown;
    if(body.query.includes("ProductsGet(")) response={product:{id:"product-1",title:"Test",handle:"test",variants:{edges:[{node:variant}],pageInfo:{hasNextPage:true}}}};
    else {pageReads++;response={product:{variants:{nodes:[variant,{...variant,id:"variant-2"}],pageInfo:{hasNextPage:false}}}};}
    return new Response(JSON.stringify({data:response}),{headers:{"content-type":"application/json"}});
  }});
  assert.equal((await executeProductsGet(store,client,{id:"product-1"})).product?.hasMoreVariants,true);
  assert.equal(pageReads,0);
  const complete=await executeProductsGet(store,client,{id:"product-1",includeAllVariants:true});
  assert.equal(complete.product?.variants.length,2);
  assert.equal(complete.product?.hasMoreVariants,false);
  assert.equal(pageReads,1);
});
