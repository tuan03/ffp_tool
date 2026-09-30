export function mergeReviewPictureUrls(generatedUrls: readonly string[], manualText: string): readonly string[] {
  const manualUrls = manualText.split(/[\s,;]+/).map((url) => url.trim()).filter(Boolean);
  return [...new Set([...generatedUrls, ...manualUrls].filter((url) => /^https?:\/\//i.test(url)))];
}
