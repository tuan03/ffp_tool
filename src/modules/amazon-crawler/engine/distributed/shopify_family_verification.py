"""Server-owned Shopify reads for an audited, partial family recovery."""
from __future__ import annotations

import json
import os
import uuid
import urllib.error
import urllib.request


def gateway_read(store_id: str, operation: str, payload: dict) -> dict:
    endpoint = os.environ.get("SHOPIFY_GATEWAY_URL") or f"http://127.0.0.1:{os.environ.get('GATEWAY_PORT', '3001')}/api/shopify"
    request = urllib.request.Request(endpoint, data=json.dumps({
        "storeId": store_id, "operation": operation, "mode": "apply", "payload": payload,
        "requestId": f"family-verification-{uuid.uuid4().hex}",
    }).encode("utf-8"), headers={
        "Content-Type": "application/json", "x-gateway-key": os.environ.get("GATEWAY_AUTH_TOKEN", ""),
    }, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
        raise ValueError("Không xác minh được Shopify; chưa mở khóa. Kiểm tra kết nối và quyền store rồi thử lại.") from error
    if not isinstance(result, dict) or result.get("success") is not True or not isinstance(result.get("data"), dict):
        raise ValueError("Shopify chưa xác nhận kết quả kiểm tra; không thay đổi dữ liệu family.")
    return result["data"]


def verify_shopify_family(store_id: str, parent_asin: str, asins: set[str], product_ids: set[str]) -> dict[str, set[str]]:
    missing_ids: set[str] = set()
    for product_id in sorted(product_ids):
        result = gateway_read(store_id, "products.get", {"id": product_id})
        # Only explicit GraphQL product:null is proof of deletion. A missing
        # field, HTTP 404, permission error or failed search is never proof.
        if "product" not in result:
            raise ValueError("Shopify trả dữ liệu kiểm tra không hợp lệ; chưa mở khóa.")
        if result["product"] is None:
            missing_ids.add(product_id)
        elif not isinstance(result["product"], dict) or result["product"].get("id") != product_id:
            raise ValueError("Shopify trả sai danh tính sản phẩm; chưa mở khóa.")
    existing_asins: set[str] = set()
    # Exact queries prevent a stale ID from allowing duplicates when someone
    # created a replacement product for the same ASIN outside this pipeline.
    for offset in range(0, len(asins), 200):
        batch = sorted(asins)[offset:offset + 200]
        result = gateway_read(store_id, "products.preflightAmazonAsins", {
            "asins": batch,
            "families": [{"parentAsin": parent_asin, "inputAsins": [asin], "memberAsins": batch} for asin in batch],
        })
        if result.get("ready") is not True or not isinstance(result.get("matches"), list):
            raise ValueError("Shopify chưa sẵn sàng kiểm tra ASIN; hãy thử lại, dữ liệu vẫn được giữ nguyên.")
        for match in result["matches"]:
            if not isinstance(match, dict) or not isinstance(match.get("asin"), str):
                raise ValueError("Shopify trả ASIN không hợp lệ; chưa mở khóa.")
            existing_asins.add(match["asin"])
    return {"missingProductIds": missing_ids, "existingAsins": existing_asins}
