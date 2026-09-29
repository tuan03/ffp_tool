# FFP Review Image Bridge

Load this directory as an unpacked Chrome extension. It connects to the local review-image service at `ws://127.0.0.1:8770/ws/extension`, not the crawler coordinator on port `8766`.

After importing, pin a signed-in ChatGPT tab, reload that tab, open the extension popup, enter the token from the root `.env.local` (`REVIEW_IMAGE_BRIDGE_TOKEN`), and enable the connection. If the token is not set for local testing, the current development default is `change-this-token`.

The extension attaches the scene template first and product image second. It waits for both uploads before sending the prompt. ChatGPT can still alter fine artwork or text, so approve only after visual inspection in the FFP Tool page.
