import type { SeoContentInput, SeoContentOutput } from "../types";

export const seoContentMockInput: SeoContentInput = {
  images: [
    {
      id: "img-mock-1",
      url: "https://example.com/assets/halloween-cat-rug-main.jpg",
      alt: "Vintage distressed black cat Halloween rug styled in living room",
      localFilePath: "/temp/assets/halloween-cat-rug-main.jpg",
    },
    {
      id: "img-mock-2",
      url: "https://example.com/assets/halloween-cat-rug-detail.jpg",
      alt: "Close-up detail of textured fabric and stitching on black cat rug",
      localFilePath: "/temp/assets/halloween-cat-rug-detail.jpg",
    },
  ],
  niche: "vintage distressed rug",
  title: "Black Cat Halloween Rug - Spooky Vintage Living Room Area Mat",
  description:
    "<p>Elevate your seasonal decor with this vintage distressed Halloween rug featuring an eerie black cat and autumn botanicals. Crafted with low-pile washable fabric, it brings cozy gothic charm to living rooms, entryways, or covered porches.</p>",
  handle: "vintage-black-cat-halloween-rug",
};

export const seoContentMockData: SeoContentOutput = {
  productTitle: "Vintage Black Cat Halloween Rug, Distressed Gothic Area Rug for Living Room",
  productDescription: [
    '<div class="product-description">',
    "  <p>Bring mysterious gothic warmth into your living space with this vintage distressed black cat Halloween rug. Designed with intricate autumn foliage and moody vintage tones, this statement piece blends seasonal festivity with year-round vintage appeal.</p>",
    "  <h3>Key Features</h3>",
    "  <ul>",
    "    <li>Durable low-pile polyester fabric resistant to shedding and daily foot traffic.</li>",
    "    <li>Non-slip TPR backing keeps the rug firmly in place on hardwood and tile floors.</li>",
    "    <li>Easy machine-washable maintenance for busy households with pets or kids.</li>",
    "  </ul>",
    "  <h3>Specifications & Care</h3>",
    "  <p>Machine wash cold on gentle cycle. Lay flat or hang dry. Do not bleach.</p>",
    "</div>",
  ].join("\n"),
  productSeoTitle: "Vintage Black Cat Halloween Rug | Gothic Distressed Living Room Mat",
  productSeoDescription:
    "Shop our vintage black cat Halloween rug featuring distressed gothic styling, low-pile washable fabric, and non-slip backing. Perfect cozy seasonal decor.",
  images: [
    {
      sourceUrl: "https://example.com/assets/halloween-cat-rug-main.jpg",
      alt: "Vintage distressed black cat Halloween rug styled in cozy living room setting",
      webp: {
        filename: "vintage-black-cat-halloween-rug-main.webp",
        localFilePath: "/temp/assets/vintage-black-cat-halloween-rug-main.webp",
        url: "/api/assets/vintage-black-cat-halloween-rug-main.webp",
      },
    },
    {
      sourceUrl: "https://example.com/assets/halloween-cat-rug-detail.jpg",
      alt: "Close-up texture and non-slip backing of vintage black cat Halloween area rug",
      webp: {
        filename: "vintage-black-cat-halloween-rug-detail.webp",
        localFilePath: "/temp/assets/vintage-black-cat-halloween-rug-detail.webp",
        url: "/api/assets/vintage-black-cat-halloween-rug-detail.webp",
      },
    },
  ],
  productHandle: "vintage-black-cat-halloween-rug",
  aeo_quick_summary:
    "The Vintage Black Cat Halloween Rug is a low-pile polyester area rug designed for vintage and gothic decor enthusiasts. Featuring an eerie black cat and autumn botanicals with non-slip TPR backing, it provides durable, machine-washable seasonal charm for living rooms and entryways.",
  aeo_faq: [
    {
      question: "How do I choose the right vintage black cat Halloween rug for my living room?",
      answer:
        "Choose by assessing your room dimensions, floor surface, and lighting. This rug features low-pile polyester with a non-slip TPR backing, ensuring it lays flat under furniture without bunching or sliding.",
    },
    {
      question: "Is this black cat rug suitable for high-traffic entryways and homes with pets?",
      answer:
        "Yes. The low-pile construction resists shedding and claw snagging, while the non-slip TPR backing ensures stability on hardwood, laminate, or tile floors under daily foot traffic.",
    },
    {
      question: "What is included with this rug, and how should it be cleaned?",
      answer:
        "The package includes one area rug. For regular care, vacuum without a beater bar or machine wash cold on a gentle cycle. Lay flat or hang to air dry; do not bleach.",
    },
    {
      question: "What makes this vintage black cat rug different from generic Halloween mats?",
      answer:
        "Unlike disposable festive mats, this edition features intricate autumn botanicals and distressed gothic artwork printed on durable, washable fabric designed for year-round aesthetic appeal.",
    },
  ],
  aeo_json_ld: JSON.stringify(
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Product",
          name: "Vintage Black Cat Halloween Rug, Distressed Gothic Area Rug for Living Room",
          description:
            "Shop our vintage black cat Halloween rug featuring distressed gothic styling, low-pile washable fabric, and non-slip backing. Perfect cozy seasonal decor.",
        },
        {
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: "How do I choose the right vintage black cat Halloween rug for my living room?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Choose by assessing your room dimensions, floor surface, and lighting. This rug features low-pile polyester with a non-slip TPR backing, ensuring it lays flat under furniture without bunching or sliding.",
              },
            },
            {
              "@type": "Question",
              name: "Is this black cat rug suitable for high-traffic entryways and homes with pets?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Yes. The low-pile construction resists shedding and claw snagging, while the non-slip TPR backing ensures stability on hardwood, laminate, or tile floors under daily foot traffic.",
              },
            },
            {
              "@type": "Question",
              name: "What is included with this rug, and how should it be cleaned?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "The package includes one area rug. For regular care, vacuum without a beater bar or machine wash cold on a gentle cycle. Lay flat or hang to air dry; do not bleach.",
              },
            },
            {
              "@type": "Question",
              name: "What makes this vintage black cat rug different from generic Halloween mats?",
              acceptedAnswer: {
                "@type": "Answer",
                text: "Unlike disposable festive mats, this edition features intricate autumn botanicals and distressed gothic artwork printed on durable, washable fabric designed for year-round aesthetic appeal.",
              },
            },
          ],
        },
      ],
    },
    null,
    2,
  ),
};
