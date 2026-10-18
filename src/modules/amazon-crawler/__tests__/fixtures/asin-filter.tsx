import { useState } from "react";
import { createRoot } from "react-dom/client";

import { createShopifyAsinFilter } from "../../service";
import { ShopifyAsinFilterPanel } from "../../ui/components/ShopifyAsinFilterPanel";

const filter = createShopifyAsinFilter(fetch, { engineUrl: "" });
function FilterFixture(): React.JSX.Element {
  const [storeId, setStoreId] = useState("first");
  const [selectedAsin, setSelectedAsin] = useState("");
  return <>
    <button type="button" onClick={() => setStoreId(storeId === "first" ? "second" : "first")}>Đổi store</button>
    <output aria-label="ASIN đã chọn">{selectedAsin}</output>
    <ShopifyAsinFilterPanel key={storeId} storeId={storeId} filterShopifyAsins={filter}
      onSelectAsin={(asin) => setSelectedAsin(asin)} isSelectionDisabled={false} />
  </>;
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<FilterFixture />);
