# BÃ¡o cÃ¡o Triá»ƒn khai Stage B6: Image Processing & Alt Text (Xá»­ lÃ½ áº£nh & Tá»‘i Æ°u Alt Text)

## 1. Giá»›i thiá»‡u tá»•ng quan

Stage B6 lÃ  cháº·ng cuá»‘i cÃ¹ng trong pipeline SEO Content, chá»‹u trÃ¡ch nhiá»‡m nháº­n táº­p áº£nh sáº£n pháº©m gá»‘c (`context.source.images`) cÃ¹ng cÃ¡c thÃ´ng tin Ä‘Ã£ Ä‘Æ°á»£c phÃ¢n tÃ­ch vÃ  sinh ra tá»« cÃ¡c stage trÆ°á»›c:
- TiÃªu Ä‘á» vÃ  handle sáº£n pháº©m (`context.contentResult.productTitle`, `context.contentResult.productHandle`);
- Tá»« khÃ³a chÃ­nh vÃ  danh sÃ¡ch tá»« khÃ³a má»¥c tiÃªu (`context.contentGenerationMetadata.primaryKeyword`, `targetedKeywords`);
- Hiá»ƒu biáº¿t thá»‹ giÃ¡c vÃ  thá»±c thá»ƒ sáº£n pháº©m (`context.productUnderstanding.detectedEntities`, `visualStyle`, `productCategory`);
- TiÃªu Ä‘á» gá»‘c vÃ  alt text ban Ä‘áº§u (`context.source.title`, `image.alt`).

Tá»« cÃ¡c dá»¯ liá»‡u trÃªn, Stage B6 thá»±c hiá»‡n:
1. **Táº¡o tÃªn file WebP chuáº©n SEO**: TÃªn file Ä‘á»‹nh dáº¡ng `${stem}-${index + 1}.webp`, báº£o vá»‡ tuyá»‡t Ä‘á»‘i chá»‘ng path traversal, chuáº©n hÃ³a kÃ½ tá»± sang kebab-case sáº¡ch, Æ°u tiÃªn theo thá»© tá»± `productHandle` -> `primaryKeyword` -> `productTitle` -> `product-image`.
2. **Táº¡o Alt Text tá»± nhiÃªn, tá»‘i Æ°u ngá»¯ cáº£nh & trá»£ nÄƒng (Accessibility)**:
   - Æ¯u tiÃªn báº£o tá»“n vÃ  lÃ m sáº¡ch `sourceAlt` náº¿u Ä‘Ã£ cÃ³ ná»™i dung mÃ´ táº£ thá»±c cháº¥t;
   - Tá»± Ä‘á»™ng bá» qua cÃ¡c alt dáº¡ng placeholder, tÃªn file (nhÆ° `IMG_1234.jpg`, `photo`, `image 1`);
   - GhÃ©p ná»‘i tá»± nhiÃªn tá»« khÃ³a chÃ­nh `primaryKeyword` (tá»‘i Ä‘a 1 láº§n, chá»‘ng nhá»“i tá»« khÃ³a) vá»›i tá»‘i Ä‘a 1â€“2 thá»±c thá»ƒ thá»‹ giÃ¡c ná»•i báº­t (`detectedEntities`) vÃ  phong cÃ¡ch (`visualStyle`);
   - Lá»c bá» triá»‡t Ä‘á»ƒ cÃ¡c stop words/generic terms (`general`, `unspecified`, `none`, `unknown`);
   - Äáº£m báº£o Ä‘á»™ dÃ i tráº§n cá»©ng <= 125 kÃ½ tá»± Unicode;
   - Äáº£m báº£o tÃ­nh Ä‘á»™c nháº¥t trong gallery: náº¿u áº£nh trÃ¹ng alt, tá»± Ä‘á»™ng gÃ¡n háº­u tá»‘ `, view ${index + 1}` mÃ  khÃ´ng bá»‹a Ä‘áº·t gÃ³c chá»¥p (do B1 lÃ  aggregate understanding);
   - LÃ m sáº¡ch 100% mÃ£ HTML, kÃ½ tá»± Ä‘iá»u khiá»ƒn vÃ  Ä‘Æ°á»ng dáº«n URL.
3. **Xá»­ lÃ½ vÃ  Chuyá»ƒn Ä‘á»•i WebP an toÃ n (Safe WebP Pipeline)**:
   - Há»— trá»£ kiáº¿n trÃºc bá»™ náº¡p nguá»“n Ä‘a nÄƒng (`ImageSourceLoader`): local file path, data URI (base64) vÃ  remote HTTP(S) URL (cÃ³ timeout 15s, giá»›i háº¡n 10MB vÃ  chá»‘ng SSRF máº¡ng ná»™i bá»™);
   - XÃ¡c thá»±c chá»¯ kÃ½ sá»‘ WebP (magic bytes `RIFF` vÃ  `WEBP`);
   - Há»— trá»£ lÆ°u trá»¯ artifact (`ImageArtifactSink`): `MemoryImageSink` cho kiá»ƒm thá»­ in-memory vÃ  `FileSystemImageSink` cho ghi Ä‘Ä©a nguyÃªn tá»­ (atomic write qua temp file + rename) kÃ¨m kiá»ƒm soÃ¡t path traversal;
   - Äáº£m báº£o tÃ­nh nháº¥t quÃ¡n: **Tuyá»‡t Ä‘á»‘i khÃ´ng fake WebP bytes**. Náº¿u khÃ´ng cÃ³ bá»™ chuyá»ƒn Ä‘á»•i hoáº·c áº£nh lá»—i trong cháº¿ Ä‘á»™ lenient, tráº£ vá» metadata lá»—i vÃ  khÃ´ng gÃ¡n trÆ°á»ng `data`/`localFilePath` giáº£ máº¡o.

---

## 2. Kiáº¿n trÃºc Module Stage B6

Stage B6 Ä‘Æ°á»£c tá»• chá»©c mÃ´-Ä‘un hÃ³a cao Ä‘á»™ táº¡i `src/modules/seo-content/internal/image-processing/`:

```text
internal/image-processing/
â”œâ”€â”€ image-processing-types.ts    # Input, Output, Issue, Metadata interfaces
â”œâ”€â”€ webp-filename-generator.ts   # Äá»™ng cÆ¡ táº¡o tÃªn file WebP chuáº©n SEO
â”œâ”€â”€ alt-text-sanitizer.ts        # XÃ³a HTML, control chars, URL, phÃ¡t hiá»‡n placeholder
â”œâ”€â”€ alt-text-fitter.ts           # Cáº¯t gá»t an toÃ n theo ranh giá»›i tá»« (<= 125 kÃ½ tá»±)
â”œâ”€â”€ alt-text-generator.ts        # Thuáº­t toÃ¡n táº¡o Alt Text tá»± nhiÃªn & Ä‘á»™c nháº¥t
â”œâ”€â”€ webp-validator.ts            # Kiá»ƒm tra magic bytes RIFF/WEBP, 1x1 WebP fixture
â”œâ”€â”€ webp-converter.ts            # Interfaces, TestConverter, UnavailableConverter, SharpConverter
â”œâ”€â”€ image-source-loader.ts       # InMemoryLoader (offline) & DefaultImageSourceLoader (SSRF safe)
â”œâ”€â”€ image-artifact-sink.ts       # MemoryImageSink & FileSystemImageSink (atomic write)
â”œâ”€â”€ image-processor.ts           # Orchestrator Ä‘iá»u phá»‘i tuáº§n tá»± tá»«ng áº£nh
â””â”€â”€ index.ts                     # Public internal barrel exports
```

---

## 3. Danh sÃ¡ch Tá»‡p triá»ƒn khai & Vai trÃ²

| Tá»‡p | Vá»‹ trÃ­ | Vai trÃ² |
| --- | --- | --- |
| `image-processing-types.ts` | `internal/image-processing/` | Äá»‹nh nghÄ©a `ImageProcessingInput`, `ImageProcessingMetadata`, `ImageProcessingIssue` |
| `webp-filename-generator.ts` | `internal/image-processing/` | Sinh tÃªn file `${stem}-${index + 1}.webp`, loáº¡i bá» directory traversal |
| `alt-text-sanitizer.ts` | `internal/image-processing/` | LÃ m sáº¡ch HTML, URL, control chars, Ä‘áº¿m kÃ½ tá»± Unicode, phÃ¡t hiá»‡n placeholder |
| `alt-text-fitter.ts` | `internal/image-processing/` | Cáº¯t gá»t text theo tá»« ngá»¯ mÃ  khÃ´ng cáº¯t vá»¥n tá»« |
| `alt-text-generator.ts` | `internal/image-processing/` | Sinh alt text cÃ³ cÄƒn cá»©, khÃ´ng spam tá»« khÃ³a, Ä‘áº£m báº£o Ä‘á»™ dÃ i vÃ  tÃ­nh duy nháº¥t |
| `webp-validator.ts` | `internal/image-processing/` | Kiá»ƒm tra chá»¯ kÃ½ magic bytes `RIFF` / `WEBP`, cung cáº¥p fixture WebP 1x1 42 bytes |
| `webp-converter.ts` | `internal/image-processing/` | Chuyá»ƒn Ä‘á»•i WebP vá»›i cÃ¡c adapter: DeterministicTest, Unavailable, Sharp |
| `image-source-loader.ts` | `internal/image-processing/` | Náº¡p dá»¯ liá»‡u áº£nh tá»« buffer, file cá»¥c bá»™, data URI hoáº·c remote URL an toÃ n |
| `image-artifact-sink.ts` | `internal/image-processing/` | LÆ°u trá»¯ WebP vÃ o bá»™ nhá»› hoáº·c ghi file há»‡ thá»‘ng nguyÃªn tá»­ |
| `image-processor.ts` | `internal/image-processing/` | TrÃ¬nh Ä‘iá»u phá»‘i chÃ­nh cá»§a B6, há»— trá»£ cháº¿ Ä‘á»™ lenient vÃ  strict |
| `b6-image-processing.ts` | `internal/stages/` | Káº¿t ná»‘i Stage B6 vÃ o luá»“ng SEO Pipeline, Ä‘Ã³ng gÃ³i lá»—i an toÃ n |
| `domain-types.ts` | `internal/` | Cáº­p nháº­t `SeoPipelineContext` thÃªm trÆ°á»ng `imageProcessingMetadata` |
| `b6-image-processing.test.ts` | `__tests__/` | 35 unit tests toÃ n diá»‡n cho toÃ n bá»™ cÃ¡c thÃ nh pháº§n vÃ  edge cases cá»§a Stage B6 |

---

## 4. Káº¿t quáº£ Kiá»ƒm thá»­ & Nghiá»‡m thu

ToÃ n bá»™ **265/265 tests** trong repository Ä‘á»u vÆ°á»£t qua (100% PASS):
- NhÃ³m B6 Unit Tests (`b6-image-processing.test.ts`): 35/35 tests PASS
  + NhÃ³m 1 (Filename Generator): Äá»‹nh dáº¡ng tÃªn file `${handle}-${index + 1}.webp`, fallback stem, chuáº©n hÃ³a kÃ½ tá»± tiáº¿ng Viá»‡t, chá»‘ng path traversal.
  + NhÃ³m 2 (Alt Sanitizer & Fitter): XÃ³a tag HTML, xÃ³a control chars, phÃ¡t hiá»‡n placeholder, cáº¯t an toÃ n ranh giá»›i tá»«.
  + NhÃ³m 3 (Alt Text Generator): Giá»¯ alt cÃ³ nghÄ©a, káº¿t há»£p primary keyword + entities, loáº¡i bá» generic stop words, Ä‘áº£m báº£o tÃ­nh duy nháº¥t trong gallery, fallback khi thiáº¿u context, tráº§n cá»©ng <= 125 kÃ½ tá»±.
  + NhÃ³m 4 (WebP Validator & Converters): Kiá»ƒm tra magic bytes RIFF/WEBP, test converter tráº£ vá» buffer há»£p lá»‡, unavailable converter nÃ©m lá»—i Ä‘áº·c thÃ¹.
  + NhÃ³m 5 (Source Loader & Sink): Load buffer in-memory offline 100%, parse data URI, cháº·n IP cá»¥c bá»™/SSRF, ghi Ä‘Ä©a nguyÃªn tá»­ vÃ  cháº·n thoÃ¡t thÆ° má»¥c.
  + NhÃ³m 6 (Processor & Edge Cases): Xá»­ lÃ½ danh sÃ¡ch áº£nh rá»—ng, báº£o toÃ n thá»© tá»± áº£nh Ä‘áº§u vÃ o, cháº¿ Ä‘á»™ lenient khÃ´ng táº¡o fake WebP data, cháº¿ Ä‘á»™ strict nÃ©m lá»—i khi convert há»ng.
  + NhÃ³m 7 (Stage Execution & Context Invariants): Context báº¥t biáº¿n, giá»¯ nguyÃªn tham chiáº¿u `source`, báº£o toÃ n `contentResult` vÃ  `corpusRevision` cá»§a B4/B5.
  + NhÃ³m 8 (Reviewer Confirmations): Kiá»ƒm thá»­ ranh giá»›i trÃ¹ng alt dÃ i 125 kÃ½ tá»±, báº£o vá»‡ chuyá»ƒn hÆ°á»›ng SSRF.
  + NhÃ³m 9 (Hardening & Edge Cases): Cháº·n toÃ n diá»‡n SSRF (cloud metadata 169.254.169.254, IPv6 brackets `[::1]`, `0.0.0.0`, link-local `fe80::`, unique-local `fd00::`, `::ffff:`), phÃ¡t hiá»‡n redirect loop tuáº§n hoÃ n, cháº·n quÃ¡ giá»›i háº¡n hops, báº£o toÃ n entities khi primaryKeyword trÃ¹ng productTitle, bá»• sung gam mÃ u chá»§ Ä‘áº¡o `dominantColors` vÃ  fallback `secondaryKeywords`.
- ToÃ n bá»™ cÃ¡c bÃ i kiá»ƒm thá»­ há»“i quy cÅ© (B1, B2, B3, B4, B5, Pipeline, Service, Mock, Orchestrator) Ä‘á»u PASS 100%.
- TypeScript Typecheck: 0 lá»—i (`npm run typecheck` pass).
- Production Build: ThÃ nh cÃ´ng (`npm run build` pass).
- Mock Build: ThÃ nh cÃ´ng (`npm run build:mock` pass).

