import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryThrottleManager, ShopifyGraphqlClient, StaticAccessTokenProvider } from "../index";
import { executeProductsUpdate } from "../operations/products-write";
import type { StoreConfig } from "../types";

const store: StoreConfig = { storeId: "test", shopDomain: "example.myshopify.com", apiVersion: "2026-07", auth: { type: "static", staticToken: "fixture" } };

test("Etsy update expands eight variants to 288, then reconciles a reversed full snapshot without duplication", async () => {
  let nextId = 8;
  let snapshots = Array.from({length:8},(_,i)=>({id:`gid://shopify/ProductVariant/${i}`,title:`Size ${i}`,price:"24.00",sku:`BASE-${i}`}));
  const desired = Array.from({length:288},(_,i)=>({price:"24.00",sku:`ETSY-1234567890-${String(i).padStart(4,"0")}`,legacySku:`BASE-${Math.floor(i/36)}`,
    optionValues:[{optionName:"Size",name:`Size ${Math.floor(i/36)}`},{optionName:"Color",name:`Color ${Math.floor(i/6)%6}`},{optionName:"Tone",name:`Tone ${i%6}`}]}));
  const mutations: {name:string; count:number}[] = [];
  let failSecondCreate = false;
  const productId = "gid://shopify/Product/1";
  const client = new ShopifyGraphqlClient({tokenProvider:new StaticAccessTokenProvider(),throttleManager:new InMemoryThrottleManager(),
    baseTransport:async(_url,init)=>{
      const body = JSON.parse(String(init?.body)) as { query:string; variables:Record<string,unknown> };
      const q=body.query; const v=body.variables;
      let response: unknown;
      if(q.includes("ProductVariantLimits")) response={shop:{resourceLimits:{maxProductOptions:3,maxProductVariants:2048}}};
      else if(q.includes("PipelineProductState")) response={node:{options:[{name:"Size"}],variants:{nodes:snapshots.slice(0,250),pageInfo:{hasNextPage:snapshots.length>250}}}};
      else if(q.includes("ProductVariantPage")) { const start=Number(v.after??0);response={product:{variants:{nodes:snapshots.slice(start,start+250),pageInfo:{hasNextPage:start+250<snapshots.length,endCursor:String(start+250)}}}}; }
      else if(q.includes("mutation ProductUpdate")) response={productUpdate:{product:{id:productId,title:"Test",handle:"test",tags:[],variants:{edges:[]}},userErrors:[]}};
      else if(q.includes("ProductOptionsCreateForSync")) response={productOptionsCreate:{product:{id:productId},userErrors:[]}};
      else if(q.includes("productVariantsBulkUpdate") || q.includes("productVariantsBulkCreate")) {
        const creating=q.includes("productVariantsBulkCreate");
        const input=v.variants as {id?:string;price:string;inventoryItem:{sku:string}}[];
        mutations.push({name:creating?"create":"update",count:input.length});
        if(creating && failSecondCreate && input.length<250) response={productVariantsBulkCreate:{productVariants:[],userErrors:[{message:"Simulated chunk failure"}]}};
        else {
          const output=input.map(variant=>{
            const row={id:variant.id??`gid://shopify/ProductVariant/${nextId++}`,price:variant.price,title:"Variant",sku:variant.inventoryItem.sku};
            const index=snapshots.findIndex(s=>s.id===row.id);if(index<0)snapshots.push(row);else snapshots[index]=row;
            return {...row,inventoryItem:{sku:row.sku}};
          });
          response=creating?{productVariantsBulkCreate:{productVariants:output,userErrors:[]}}:{productVariantsBulkUpdate:{productVariants:output,userErrors:[]}};
        }
      } else throw new Error(`Unexpected query ${q.slice(0,60)}`);
      return new Response(JSON.stringify({data:response}),{headers:{"content-type":"application/json"}});
    }});
  const managed = snapshots.map(v=>v.id);
  const payload={id:productId,product:{variantIdentity:"etsy-personalization-v1",title:"Test",variantIdsToManage:managed,variants:desired}};
  failSecondCreate=true;
  await assert.rejects(executeProductsUpdate(store,client,payload,"apply","first"), /failed to synchronize variants/);
  assert.equal(snapshots.length,258);
  failSecondCreate=false;
  snapshots.reverse();
  const recovered=await executeProductsUpdate(store,client,payload,"apply","recover");
  assert.equal(recovered.product.variants.length,288);
  assert.equal(snapshots.length,288);
  assert.equal(new Set(snapshots.map(v=>v.sku)).size,288);
  const before=mutations.length;
  const idBySku=new Map(snapshots.map(v=>[v.sku,v.id]));
  snapshots.reverse();
  await executeProductsUpdate(store,client,{...payload,product:{...payload.product,variantIdsToManage:snapshots.map(v=>v.id),variants:[...desired].reverse()}},"apply","repeat");
  assert.ok(mutations.slice(before).every(m=>m.name==="update"));
  assert.ok(mutations.every(m=>m.count<=250));
  assert.ok(snapshots.every(v=>idBySku.get(v.sku)===v.id));
});
