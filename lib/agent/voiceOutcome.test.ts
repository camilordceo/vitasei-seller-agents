import { describe, expect, it } from "vitest";
import {
  buildOrderDraftFromCall,
  defaultOutcomeExtractor,
  findOutcomeExtractor,
  isSaleOutcome,
  matchPaymentText,
  readOutcome,
  resolveOrderField,
} from "./voiceOutcome";
import type { VoiceExtractor } from "@/lib/synthflow/types";

/**
 * Lo que se protege aquí es una regla de negocio con plata de por medio: cuándo
 * una llamada se convierte en una orden. Un falso positivo despacha mercancía
 * que nadie pidió.
 */

const ex = (partial: Partial<VoiceExtractor> & { identifier: string }): VoiceExtractor => ({
  type: "OPEN_QUESTION",
  condition: "algo",
  choices: [],
  examples: [],
  actionId: null,
  outcome: false,
  saleValues: [],
  orderField: null,
  ...partial,
});

describe("findOutcomeExtractor", () => {
  it("devuelve el marcado como resultado", () => {
    const list = [ex({ identifier: "nombre" }), ex({ identifier: "resultado", outcome: true })];
    expect(findOutcomeExtractor(list)?.identifier).toBe("resultado");
  });

  it("sin ninguno marcado, no inventa", () => {
    expect(findOutcomeExtractor([ex({ identifier: "nombre" })])).toBeNull();
  });
});

describe("readOutcome", () => {
  const outcome = ex({ identifier: "resultado_llamada", outcome: true, saleValues: ["compra"] });

  it("lee el valor extraído", () => {
    expect(readOutcome({ resultado_llamada: "compra" }, outcome)).toBe("compra");
  });

  it("sin dato en esa llamada devuelve null", () => {
    expect(readOutcome({ nombre: "Ana" }, outcome)).toBeNull();
  });

  it("sin extractor de resultado devuelve null", () => {
    expect(readOutcome({ resultado_llamada: "compra" }, null)).toBeNull();
  });
});

describe("isSaleOutcome", () => {
  it("acepta la coincidencia exacta ignorando tildes y mayúsculas", () => {
    expect(isSaleOutcome("Compra", ["compra"])).toBe(true);
    expect(isSaleOutcome("COMPRÓ", ["compro"])).toBe(true);
    expect(isSaleOutcome("compra.", ["compra"])).toBe(true);
  });

  it("NO dispara con 'no compra' (el bug que mataría la feature)", () => {
    expect(isSaleOutcome("no compra", ["compra"])).toBe(false);
    expect(isSaleOutcome("no interesada", ["compra"])).toBe(false);
  });

  it("sin valores de venta configurados, nunca es venta", () => {
    expect(isSaleOutcome("compra", [])).toBe(false);
    expect(isSaleOutcome(null, ["compra"])).toBe(false);
  });

  it("acepta varias opciones de compra", () => {
    expect(isSaleOutcome("pago anticipado", ["compra", "pago anticipado"])).toBe(true);
  });
});

describe("resolveOrderField", () => {
  it("respeta el campo elegido a mano", () => {
    expect(resolveOrderField(ex({ identifier: "cualquiera", orderField: "city" }))).toBe("city");
  });

  it("deduce del nombre del extractor", () => {
    expect(resolveOrderField(ex({ identifier: "direccion_entrega" }))).toBe("address");
    expect(resolveOrderField(ex({ identifier: "nombre" }))).toBe("name");
    expect(resolveOrderField(ex({ identifier: "metodo_pago" }))).toBe("payment");
  });

  it("un identificador compuesto se resuelve por el término más específico", () => {
    expect(resolveOrderField(ex({ identifier: "nombre_producto" }))).toBe("product");
  });

  it("el extractor de resultado no alimenta ningún campo", () => {
    expect(resolveOrderField(ex({ identifier: "resultado", outcome: true }))).toBeNull();
  });
});

describe("buildOrderDraftFromCall", () => {
  const extractors = [
    defaultOutcomeExtractor(),
    ex({ identifier: "nombre", orderField: "name" }),
    ex({ identifier: "direccion", orderField: "address" }),
    ex({ identifier: "ciudad", orderField: "city" }),
    ex({ identifier: "producto", orderField: "product" }),
    ex({ identifier: "cantidad", orderField: "qty" }),
    ex({ identifier: "metodo_pago", orderField: "payment" }),
  ];

  it("mapea los datos de la llamada a la orden", () => {
    const { draft, paymentText, productText } = buildOrderDraftFromCall(extractors, {
      resultado_llamada: "compra",
      nombre: "Laura Caicedo",
      direccion: "Calle 145 #20-30",
      ciudad: "Bogotá",
      producto: "Colágeno hidrolizado",
      cantidad: "2 unidades",
      metodo_pago: "contra entrega",
    });

    expect(draft.shipping).toEqual({
      name: "Laura Caicedo",
      address: "Calle 145 #20-30",
      city: "Bogotá",
      phone: null,
    });
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0].name).toBe("Colágeno hidrolizado");
    expect(draft.items[0].qty).toBe(2);
    expect(paymentText).toBe("contra entrega");
    expect(productText).toBe("Colágeno hidrolizado");
  });

  it("el resultado NO se cuela como dato de la orden", () => {
    const { draft } = buildOrderDraftFromCall(extractors, { resultado_llamada: "compra" });
    expect(draft.notes).toBeNull();
    expect(draft.items).toHaveLength(0);
  });

  it("lo que no mapea a ningún campo cae en las notas (no se pierde)", () => {
    const { draft } = buildOrderDraftFromCall(extractors, {
      talla: "M",
      nombre: "Ana",
    });
    expect(draft.notes).toContain("Talla: M");
    expect(draft.shipping.name).toBe("Ana");
  });

  it("un valor anidado se aplana a texto legible", () => {
    const { draft } = buildOrderDraftFromCall(extractors, {
      direccion: { calle: "Cra 7 #80-15", barrio: "Chapinero" },
    });
    expect(draft.shipping.address).toBe("calle: Cra 7 #80-15, barrio: Chapinero");
  });

  it("sin cantidad, la cantidad es 1", () => {
    const { draft } = buildOrderDraftFromCall(extractors, { producto: "Magnesio" });
    expect(draft.items[0].qty).toBe(1);
  });
});

describe("matchPaymentText", () => {
  const methods = [
    { tag: "#compra-contra-entrega", label: "Contra entrega", method: "cod" },
    { tag: "#addi", label: "Addi", method: "addi" },
  ];

  it("homologa por etiqueta, clave o tag", () => {
    expect(matchPaymentText("contra entrega", methods)).toBe("cod");
    expect(matchPaymentText("Addi", methods)).toBe("addi");
    expect(matchPaymentText("compra contra entrega", methods)).toBe("cod");
  });

  it("un método que el agente no tiene no se inventa", () => {
    expect(matchPaymentText("bitcoin", methods)).toBeNull();
    expect(matchPaymentText(null, methods)).toBeNull();
  });
});
