import assert from "node:assert/strict";
import test from "node:test";
import { AdsIntelligenceService } from "../ads-intelligence/service";
import { MetaClient } from "../ads-intelligence/meta-client";
import { loadStoreAdsProfile } from "../ads-intelligence/store-profile";
import { configureAdsGateway } from "../ads-intelligence/gateway-connection";
import { ShopifyGraphqlClient } from "../shopify-graphql-client";
import { InMemoryThrottleManager } from "../throttle-manager";

test("Ads overview requests maximum history and preserves source dates", async context => {
  const profile = loadStoreAdsProfile("jeminise");
  const key = profile.meta.secretRef || "META_ACCESS_TOKEN";
  const original = process.env[key]; process.env[key] = "fixture";
  const store = {storeId:"jeminise",shopDomain:profile.shopify.shopDomain,apiVersion:"2026-07",auth:{type:"static" as const,staticToken:"fixture"}};
  configureAdsGateway({storeRegistry:{getStore:()=>store,listStores:()=>[store]},graphqlClient:new ShopifyGraphqlClient({tokenProvider:{getToken:async()=>"fixture",invalidate(){}},throttleManager:new InMemoryThrottleManager()})});
  context.mock.method(MetaClient.prototype,"getAccount",async()=>({id:"fixture",name:"fixture",currency:profile.reportingCurrency,timezone_name:"UTC"}));
  context.mock.method(MetaClient.prototype,"getAccountInsights",async (_id:string, preset:string)=>{
    assert.equal(preset,"maximum");
    return [{spend:"10",impressions:"100",clicks:"1",actions:[],action_values:[],date_start:"2024-01-01",date_stop:"2026-10-05"}];
  });
  try {
    const report=await new AdsIntelligenceService().getStoreSummary("jeminise",true);
    assert.equal(report.periodStart,"2024-01-01");assert.equal(report.periodEnd,"2026-10-05");
  } finally {if(original===undefined)delete process.env[key];else process.env[key]=original;}
});
