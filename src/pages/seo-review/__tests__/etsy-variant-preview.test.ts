import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EtsyVariantPreview } from "../components/EtsyVariantPreview";
import type { CrawlProduct } from "../../../modules/customization-normalizer";

test("Review shows projected Etsy variants and hides the projection for Amazon", () => {
  const product: CrawlProduct = {sourcePlatform:"etsy",sourceProductId:"1234567890",title:"Test",
    variants:[{price:24,options:{Size:"M"},sourceVariantId:"12345678"}],
    customization:{hasCustomization:true,optionGroups:[{id:"color",label:"Color",required:true,options:[{id:"red",label:"Red"},{id:"blue",label:"Blue"}]}]},
  };
  const html=renderToStaticMarkup(createElement(EtsyVariantPreview,{product}));
  assert.match(html,/2 biến thể Shopify/);
  assert.match(html,/Size · Color/);
  assert.match(html,/Không cần popup Customize/);
  assert.equal(renderToStaticMarkup(createElement(EtsyVariantPreview,{product:{...product,sourcePlatform:"amazon"}})),"");
});
