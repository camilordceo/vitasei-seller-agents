import { describe, expect, it } from "vitest";
import {
  missingVariables,
  normalizeVariableKey,
  normalizeVariables,
  renderTemplate,
  templateVariables,
} from "./voiceTemplate";

describe("normalizeVariableKey", () => {
  it("aplana tildes, mayúsculas y espacios (la columna del Excel y la llave del saludo son la misma)", () => {
    expect(normalizeVariableKey("Producto Interesado")).toBe("producto_interesado");
    expect(normalizeVariableKey("  ÚLTIMA compra ")).toBe("ultima_compra");
    expect(normalizeVariableKey("teléfono")).toBe("telefono");
  });

  it("no devuelve basura", () => {
    expect(normalizeVariableKey("")).toBe("");
    expect(normalizeVariableKey("   ")).toBe("");
    expect(normalizeVariableKey("***")).toBe("");
  });
});

describe("templateVariables", () => {
  it("lee el saludo real del negocio", () => {
    expect(
      templateVariables(
        "Hola, soy Vanessa de Vitasei. Te llamaba porque estabas interesado en {producto}, ¿tienes un minuto?",
      ),
    ).toEqual(["producto"]);
  });

  it("acepta llave doble y espacios adentro", () => {
    expect(templateVariables("Hola {{ nombre }}, tu {Producto Interesado} ya llegó")).toEqual([
      "nombre",
      "producto_interesado",
    ]);
  });

  it("no repite y respeta el orden de aparición", () => {
    expect(templateVariables("{producto} y otro {producto} con {nombre}")).toEqual([
      "producto",
      "nombre",
    ]);
  });

  it("un texto sin llaves no tiene variables", () => {
    expect(templateVariables("Hola, ¿tienes un minuto?")).toEqual([]);
    expect(templateVariables("")).toEqual([]);
  });
});

describe("normalizeVariables", () => {
  it("canoniza las claves y recorta los valores", () => {
    expect(normalizeVariables({ "Producto ": " Colágeno " })).toEqual({ producto: "Colágeno" });
  });

  it("una variable vacía es una variable que falta", () => {
    expect(normalizeVariables({ producto: "", nombre: "   ", ciudad: null })).toEqual({});
  });

  it("no deja pasar un párrafo entero", () => {
    const long = "x".repeat(500);
    expect(normalizeVariables({ producto: long }).producto).toHaveLength(200);
  });
});

describe("renderTemplate", () => {
  it("resuelve el saludo con el producto de la fila", () => {
    expect(
      renderTemplate(
        "Hola, soy Vanessa de Vitasei. Te llamaba porque estabas interesado en {producto}, ¿tienes un minuto?",
        { producto: "el colágeno" },
      ),
    ).toBe(
      "Hola, soy Vanessa de Vitasei. Te llamaba porque estabas interesado en el colágeno, ¿tienes un minuto?",
    );
  });

  it("cruza la columna del archivo con la llave escrita a mano", () => {
    expect(renderTemplate("Tu {Producto Interesado} está listo", { producto_interesado: "magnesio" }))
      .toBe("Tu magnesio está listo");
  });

  it("lo que falta se borra y la frase queda limpia — el bot NO lee la llave", () => {
    const out = renderTemplate("estabas interesado en {producto}, ¿tienes un minuto?", {});
    expect(out).not.toContain("{");
    expect(out).not.toContain("producto");
    expect(out).toBe("estabas interesado en, ¿tienes un minuto?");
  });

  it("con onMissing:keep deja la llave (para previsualizar en el dashboard)", () => {
    expect(renderTemplate("interesado en {producto}", {}, { onMissing: "keep" })).toBe(
      "interesado en {producto}",
    );
  });

  it("un valor vacío cuenta como faltante", () => {
    expect(renderTemplate("Hola {nombre}", { nombre: "  " })).toBe("Hola");
  });

  it("no toca un texto sin variables", () => {
    expect(renderTemplate("Hola, ¿tienes un minuto?", { producto: "x" })).toBe(
      "Hola, ¿tienes un minuto?",
    );
  });
});

describe("missingVariables", () => {
  it("dice exactamente cuál falta", () => {
    expect(missingVariables("Hola {nombre}, tu {producto}", { nombre: "Ana" })).toEqual([
      "producto",
    ]);
  });

  it("sin faltantes devuelve vacío", () => {
    expect(missingVariables("Hola {nombre}", { Nombre: "Ana" })).toEqual([]);
  });
});
