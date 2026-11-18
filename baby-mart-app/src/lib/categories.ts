/** The five Baby Mart categories as POS names them (DIM_PRODUCT.CATEGORY), with
 *  the URL slug the category pages use. */
export const CATEGORIES = [
  { slug: "prams-strollers", name: "Prams & Strollers" },
  { slug: "car-seats", name: "Car Seats" },
  { slug: "nappies-wipes", name: "Nappies & Wipes" },
  { slug: "clothing", name: "Clothing" },
  { slug: "feeding", name: "Feeding" },
] as const;

export const categoryBySlug = (slug: string) => CATEGORIES.find((c) => c.slug === slug) ?? null;
export const categorySlug = (name: string) => CATEGORIES.find((c) => c.name === name)?.slug ?? null;
