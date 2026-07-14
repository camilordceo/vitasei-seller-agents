import { describe, expect, it } from "vitest";
import { buildContactContext, firstName, prependContactContext } from "./contactContext";

describe("firstName", () => {
  it("toma el primer nombre y lo capitaliza", () => {
    expect(firstName("María José")).toBe("María");
    expect(firstName("juan pablo")).toBe("Juan");
  });

  it("ignora emojis/símbolos alrededor del nombre", () => {
    expect(firstName("🌸mafe🌸")).toBe("Mafe");
    expect(firstName("  ·Ana·  ")).toBe("Ana");
  });

  it("conserva guiones y apóstrofos dentro del nombre", () => {
    expect(firstName("Juan-Pablo Restrepo")).toBe("Juan-Pablo");
  });

  it("devuelve null cuando no hay un nombre usable", () => {
    expect(firstName(null)).toBeNull();
    expect(firstName(undefined)).toBeNull();
    expect(firstName("")).toBeNull();
    expect(firstName("573001234567")).toBeNull(); // teléfono como nombre
    expect(firstName("A")).toBeNull(); // una sola inicial
  });
});

describe("buildContactContext", () => {
  it("incluye el nombre cuando es usable", () => {
    const ctx = buildContactContext("Laura Gómez");
    expect(ctx).toContain("Laura");
    expect(ctx).toContain("género");
  });

  it("devuelve cadena vacía sin nombre usable", () => {
    expect(buildContactContext(null)).toBe("");
    expect(buildContactContext("573001234567")).toBe("");
  });
});

describe("prependContactContext", () => {
  it("antepone el contexto al texto del turno", () => {
    const out = prependContactContext("hola, ¿tienen magnesio?", "Andrés");
    expect(out.startsWith("[Contexto interno")).toBe(true);
    expect(out).toContain("Andrés");
    expect(out.endsWith("hola, ¿tienen magnesio?")).toBe(true);
  });

  it("no toca el texto si no hay nombre usable", () => {
    expect(prependContactContext("hola", null)).toBe("hola");
  });

  it("devuelve solo el contexto si el turno viene vacío (solo imagen)", () => {
    expect(prependContactContext("", "Sofía")).toBe(buildContactContext("Sofía"));
    expect(prependContactContext("   ", "Sofía")).toBe(buildContactContext("Sofía"));
  });
});
