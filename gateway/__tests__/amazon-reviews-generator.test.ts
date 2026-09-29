import assert from "node:assert/strict";
import test from "node:test";

import { generateReviewSamples } from "../amazon-reviews-generator";

test("review batches vary sentence counts and limit I openings", async () => {
  const output = await generateReviewSamples({
    asin: "B012345678", count: 5,
    product: { title: "Deer pattern rug", description: "A rug with a printed deer pattern and autumn colors." },
    sourceReviews: [], priorSamples: [],
  }, async (plans) => plans.map((plan) => ({
    author: `Author ${plan.index + 1}`, rating: plan.rating,
    body: [
      "The deer pattern is clear.",
      "The autumn colors look balanced together.",
      "The printed design is easy to see.",
      "The rug has a distinct deer print.",
      "The colors feel calm and warm.",
    ][plan.index] + (plan.sentences >= 2 ? [
      " Brown tones frame the design.", " A few leaves sit near the edge.",
      " The border uses muted orange.", " Its central motif has clean lines.",
      " A pale background leaves room around the print.",
    ][plan.index] : "") + (plan.sentences === 3 ? " Small details appear near the corners." : ""),
    variantText: plan.variantText, verifiedPurchase: false,
  })));
  assert.equal(output.samples.length, 5, output.warnings.join("; "));
  assert.deepEqual(new Set(output.samples.map((sample) => sample.body.split(/[.!?](?:\s|$)/).filter(Boolean).length)), new Set([1, 2, 3]));
  assert.ok(output.samples.filter((sample) => /^I\b/.test(sample.body)).length <= 1);
  assert.ok(output.samples.every((sample) => sample.synthetic && sample.verifiedPurchase === false));
});

test("only invalid positions are repaired", async () => {
  const calls: number[] = [];
  const output = await generateReviewSamples({
    asin: "B012345678", count: 2, product: { title: "Blue floral rug", description: "Blue floral print." },
    sourceReviews: [], priorSamples: [],
  }, async (plans) => {
    calls.push(plans.length);
    return plans.map((plan, index) => ({
      author: calls.length === 2 ? "Morgan Reed" : `Author ${index + 1}`, rating: plan.rating,
      body: calls.length === 1 && index === 1 ? "Overall, a must-have product." :
        calls.length === 2 ? "Blue flowers show clearly across the rug." : "The blue floral print is easy to see.",
      variantText: plan.variantText, verifiedPurchase: false,
    }));
  });
  assert.deepEqual(calls, [2, 1]);
  assert.equal(output.samples.length, 2);
});

test("sparse facts stay brief and excessive I openings are rewritten", async () => {
  const calls: number[] = [];
  const output = await generateReviewSamples({
    asin: "B012345678", count: 3, product: { title: "Floral rug" }, sourceReviews: [], priorSamples: [],
  }, async (plans) => {
    calls.push(plans.length);
    return plans.map((plan, index) => ({
      author: calls.length === 1 ? `First ${index}` : `Repaired ${index}`,
      rating: plan.rating,
      body: calls.length === 1 ? `I like the floral print on this rug ${index}.` : [
        "Floral shapes show across this rug.",
        "The rug has a clear floral print.",
        "A flower motif stands out here.",
      ][index] ?? "The floral print is clear.",
      variantText: plan.variantText, verifiedPurchase: false,
    }));
  });
  assert.deepEqual(calls, [3, 3]);
  assert.equal(output.samples.length, 3);
  assert.ok(output.samples.every((sample) => !/^I\b/.test(sample.body)));
  assert.ok(output.samples.every((sample) => sample.body.split(/[.!?](?:\s|$)/).filter(Boolean).length === 1));
});
