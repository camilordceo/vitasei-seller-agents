import { describe, expect, it } from "vitest";
import {
  buildProductDocument,
  extensionForContentType,
  imageStoragePath,
  normalizeCatalogJson,
  parseCOP,
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

describe("parseCOP", () => {
  it("extrae dígitos de strings y números", () => {
    expect(parseCOP("245900")).toBe(245900);
    expect(parseCOP("196.700")).toBe(196700); // punto de miles
    expect(parseCOP("$196.700 COP")).toBe(196700);
    expect(parseCOP(149900)).toBe(149900);
  });
  it("devuelve null si no hay dígitos o es inválido", () => {
    expect(parseCOP("")).toBeNull();
    expect(parseCOP("gratis")).toBeNull();
    expect(parseCOP(null)).toBeNull();
    expect(parseCOP(undefined)).toBeNull();
  });
});

describe("normalizeCatalogJson", () => {
  const bubble = {
    Categoria: "Colágeno",
    Descripcion: "Colágeno hidrolizado con resveratrol.",
    Empresa: "",
    Estado: "",
    ID: "#ID7948237144231",
    Imagen: "",
    Imagenes: "https://cdn.example.com/colageno.jpg",
    ImageURL: "https://cdn.example.com/colageno.jpg",
    Link_producto: "https://tienda.example.com/colageno",
    Precio: "149900",
    PrecioConDescuento: "119900",
    PorcentajeDescuento: "20%",
    Ahorro: "30000",
    Titulo: "COLÁGENO HIDROLIZADO - COCO",
  };

  it("mapea el export Bubble y usa PrecioConDescuento como precio", () => {
    const { products, format, errors } = normalizeCatalogJson([bubble]);
    expect(format).toBe("bubble");
    expect(errors).toEqual([]);
    expect(products).toHaveLength(1);
    const p = products[0];
    expect(p.sku).toBe("#ID7948237144231");
    expect(p.name).toBe("COLÁGENO HIDROLIZADO - COCO");
    expect(p.price).toBe(119900); // PrecioConDescuento, no Precio de lista
    expect(p.currency).toBe("COP");
    expect(p.image_url).toBe("https://cdn.example.com/colageno.jpg");
    expect(p.in_stock).toBe(true); // Estado vacío → en stock
    expect(p.metadata).toMatchObject({
      categoria: "Colágeno",
      precio_lista: 149900,
      precio_con_descuento: 119900,
      descuento: "20%",
      ahorro: 30000,
    });
    // No incluye claves vacías (Empresa: "").
    expect(p.metadata).not.toHaveProperty("empresa");
  });

  it("cae a Precio de lista si no hay PrecioConDescuento", () => {
    const { products } = normalizeCatalogJson([{ ...bubble, PrecioConDescuento: "" }]);
    expect(products[0].price).toBe(149900);
  });

  it("prefiere Imagenes y usa Estado para in_stock", () => {
    const { products } = normalizeCatalogJson([
      { ...bubble, Imagenes: "", ImageURL: "https://cdn.example.com/alt.jpg", Estado: "Agotado" },
    ]);
    expect(products[0].image_url).toBe("https://cdn.example.com/alt.jpg");
    expect(products[0].in_stock).toBe(false);
  });

  it("mapea items sin ID/Titulo con sku/name vacíos (validateCatalog los rechaza)", () => {
    const { products, format } = normalizeCatalogJson([{ ID: "", Titulo: "" }]);
    expect(format).toBe("bubble");
    expect(products[0].sku).toBe("");
    const { errors } = validateCatalog({ products });
    expect(errors.some((e) => e.includes("falta `sku`"))).toBe(true);
  });

  it("pasa por alto el formato canónico (sku/name)", () => {
    const { products, format, errors } = normalizeCatalogJson([
      { sku: "VITA-9", name: "Magnesio", price: 127900, in_stock: false },
    ]);
    expect(format).toBe("canonical");
    expect(errors).toEqual([]);
    expect(products[0]).toMatchObject({ sku: "VITA-9", name: "Magnesio", price: 127900, in_stock: false });
  });

  it("reporta errores estructurales (no arreglo, vacío, formato desconocido)", () => {
    expect(normalizeCatalogJson({} as unknown).errors).toHaveLength(1);
    expect(normalizeCatalogJson([]).errors).toHaveLength(1);
    expect(normalizeCatalogJson([{ foo: "bar" }]).format).toBe("unknown");
    expect(normalizeCatalogJson([{ foo: "bar" }]).errors).toHaveLength(1);
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
