import { describe, expect, it } from "vitest";
import {
  buildProductDocument,
  extensionForContentType,
  imageStoragePath,
  parseImageData,
  productToRow,
  validateCatalog,
  type CatalogLoadRequest,
  type NormalizedProduct,
} from "./catalog";

function product(overrides: Partial<NormalizedProduct> = {}): NormalizedProduct {
  return {
    sku: "VITA-001",
    name: "Colágeno Hidrolizado",
    description: "Sobres x30",
    price: 89000,
    currency: "COP",
    in_stock: true,
    metadata: {},
    image_url: null,
    image_base64: null,
    image_content_type: null,
    ...overrides,
  };
}

describe("validateCatalog", () => {
  it("acepta un catálogo válido y normaliza defaults", () => {
    const input: CatalogLoadRequest = {
      products: [{ sku: " VITA-001 ", name: " Colágeno " }],
    };
    const { products, errors } = validateCatalog(input);
    expect(errors).toEqual([]);
    expect(products).toHaveLength(1);
    expect(products[0].sku).toBe("VITA-001"); // trim
    expect(products[0].name).toBe("Colágeno");
    expect(products[0].currency).toBe("COP"); // default
    expect(products[0].in_stock).toBe(true); // default
  });

  it("rechaza productos sin sku o sin name", () => {
    const { products, errors } = validateCatalog({
      products: [{ sku: "", name: "X" }, { sku: "Y", name: "  " }],
    });
    expect(products).toHaveLength(0);
    expect(errors.some((e) => e.includes("falta `sku`"))).toBe(true);
    expect(errors.some((e) => e.includes("falta `name`"))).toBe(true);
  });

  it("detecta SKUs duplicados (rompería el gate del #ID)", () => {
    const { errors } = validateCatalog({
      products: [
        { sku: "VITA-001", name: "A" },
        { sku: "VITA-001", name: "B" },
      ],
    });
    expect(errors.some((e) => e.includes("SKU duplicado"))).toBe(true);
  });

  it("rechaza price inválido (negativo o no numérico)", () => {
    const { errors } = validateCatalog({
      products: [{ sku: "S1", name: "A", price: -1 }],
    });
    expect(errors.some((e) => e.includes("`price`"))).toBe(true);
  });

  it("rechaza un catálogo vacío o malformado", () => {
    expect(validateCatalog({ products: [] }).errors).toHaveLength(1);
    expect(
      validateCatalog({ products: undefined as unknown as [] }).errors,
    ).toHaveLength(1);
  });
});

describe("buildProductDocument", () => {
  it("incluye el SKU de forma prominente y datos clave", () => {
    const doc = buildProductDocument(product({ metadata: { sabor: "Vainilla" } }));
    expect(doc).toContain("SKU (#ID): VITA-001");
    expect(doc).toContain("# Colágeno Hidrolizado");
    expect(doc).toContain("COP");
    expect(doc).toContain("En stock");
    expect(doc).toContain("sabor: Vainilla");
  });

  it("omite precio si no hay y marca agotado", () => {
    const doc = buildProductDocument(product({ price: null, in_stock: false }));
    expect(doc).not.toContain("Precio:");
    expect(doc).toContain("Agotado");
  });
});

describe("productToRow", () => {
  it("mapea a la fila de products sin campos de imagen/vector", () => {
    const row = productToRow(product(), "agent-1");
    expect(row.sku).toBe("VITA-001");
    expect(row.agent_id).toBe("agent-1");
    expect(row.currency).toBe("COP");
    expect(row).not.toHaveProperty("image_url");
    expect(row).not.toHaveProperty("vector_store_file_id");
  });
});

describe("imágenes", () => {
  it("extensionForContentType mapea MIME conocidos y default jpg", () => {
    expect(extensionForContentType("image/png")).toBe("png");
    expect(extensionForContentType("image/webp; charset=utf-8")).toBe("webp");
    expect(extensionForContentType(null)).toBe("jpg");
    expect(extensionForContentType("application/pdf")).toBe("jpg");
  });

  it("imageStoragePath es determinística y segura para rutas", () => {
    expect(imageStoragePath("VITA-001", "image/png")).toBe("catalog/vita-001.png");
    expect(imageStoragePath("a b/c", null)).toBe("catalog/a-b-c.jpg");
  });

  it("parseImageData separa el prefijo data-URL", () => {
    expect(parseImageData("data:image/png;base64,AAAA", null)).toEqual({
      base64: "AAAA",
      contentType: "image/png",
    });
    expect(parseImageData("AAAA", "image/jpeg")).toEqual({
      base64: "AAAA",
      contentType: "image/jpeg",
    });
  });
});
