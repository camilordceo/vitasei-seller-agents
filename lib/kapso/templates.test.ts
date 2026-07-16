import { describe, expect, it } from "vitest";
import { buildTemplateComponents, parseTemplateRef } from "./templates";

describe("parseTemplateRef", () => {
  it("usa el idioma del agente si la referencia es solo el nombre", () => {
    expect(parseTemplateRef("carrito_abandonado", "es_CO")).toEqual({
      name: "carrito_abandonado",
      language: "es_CO",
    });
  });

  it("el idioma de la referencia le gana al del agente", () => {
    expect(parseTemplateRef("carrito_abandonado:en_US", "es_CO")).toEqual({
      name: "carrito_abandonado",
      language: "en_US",
    });
  });

  it("cae a 'es' si no hay idioma por ningún lado", () => {
    expect(parseTemplateRef("plantilla", null)).toEqual({ name: "plantilla", language: "es" });
    expect(parseTemplateRef("plantilla", "  ")).toEqual({ name: "plantilla", language: "es" });
  });

  it("tolera espacios y un separador sin idioma", () => {
    expect(parseTemplateRef("  plantilla  ", "es")).toEqual({ name: "plantilla", language: "es" });
    expect(parseTemplateRef("plantilla:", "es_CO")).toEqual({
      name: "plantilla",
      language: "es_CO",
    });
  });
});

describe("buildTemplateComponents", () => {
  it("plantilla de solo texto sin variables: sin components (mandar parámetros de más la haría fallar)", () => {
    expect(buildTemplateComponents({ values: [] })).toEqual([]);
    expect(buildTemplateComponents({ values: [], imageUrl: null })).toEqual([]);
  });

  it("variables posicionales en el cuerpo, en orden", () => {
    expect(buildTemplateComponents({ values: ["Mark", "25%"] })).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Mark" },
          { type: "text", text: "25%" },
        ],
      },
    ]);
  });

  it("header de imagen + cuerpo, con el header primero", () => {
    const components = buildTemplateComponents({
      values: ["Ana"],
      imageUrl: "https://cdn.example.com/promo.jpg",
    });
    expect(components).toEqual([
      {
        type: "header",
        parameters: [{ type: "image", image: { link: "https://cdn.example.com/promo.jpg" } }],
      },
      { type: "body", parameters: [{ type: "text", text: "Ana" }] },
    ]);
  });

  it("header de imagen sin variables de cuerpo", () => {
    expect(
      buildTemplateComponents({ values: [], imageUrl: "https://cdn.example.com/p.jpg" }),
    ).toEqual([
      {
        type: "header",
        parameters: [{ type: "image", image: { link: "https://cdn.example.com/p.jpg" } }],
      },
    ]);
  });
});
