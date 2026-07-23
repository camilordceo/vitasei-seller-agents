import { describe, it, expect } from "vitest";
import {
  parseActionExtractor,
  parseExecutedActions,
  stripExtractorPrefix,
  formatExtractedValue,
  humanizeIdentifier,
} from "./extractors";

/**
 * Los fixtures de abajo son payloads REALES capturados de la cuenta de Synthflow
 * el 2026-07-18 (barrido de 82 assistants → 977 objetos `executed_actions`).
 * Cubren TODAS las formas de `return_value` observadas en producción.
 *
 * La doc de Synthflow muestra `return_value` como objeto; en la realidad es un
 * STRING con JSON adentro. Estos tests fijan la realidad, no la doc. Ver ADR-0062.
 */

const hard = (identifier: string) =>
  JSON.stringify({ identifier, condition: "…", choices: null, examples: null });

const action = (identifier: string, returnValue: string) => ({
  name: `extract_info_${identifier}`,
  action_type: "extract_info_action_type",
  description: "Get information with question: …",
  parameters_hard_coded: hard(identifier),
  parameters_from_llm: "{}",
  error_message: "",
  return_value: returnValue,
  return_value_status: "",
  is_relevant_action: "true",
  timestamp_datetime: "2025-10-26T10:34:09.638940",
  timestamp: "1761474849.6389399",
});

describe("stripExtractorPrefix", () => {
  it("acepta los DOS prefijos que conviven en la cuenta", () => {
    // `extract_info_` es el histórico; `info_extractor_` es el que genera la API
    // hoy (verificado creando un extractor real).
    expect(stripExtractorPrefix("extract_info_telefonocelular")).toBe("telefonocelular");
    expect(stripExtractorPrefix("info_extractor_necesita_subsidio")).toBe("necesita_subsidio");
  });

  it("devuelve null si no tiene prefijo conocido", () => {
    expect(stripExtractorPrefix("busqueda_llamada_durante")).toBeNull();
  });
});

describe("parseExecutedActions — formas reales de return_value", () => {
  it("string: return_value viene como JSON dentro de un string", () => {
    const out = parseExecutedActions({
      extract_info_telefonocelular: action("telefonocelular", '{"telefonocelular": "387506619"}'),
    });
    expect(out).toEqual({ telefonocelular: "387506619" });
  });

  it("number: conserva el tipo numérico", () => {
    const out = parseExecutedActions({
      extract_info_horario_de_recontacto_: action(
        "horario_de_recontacto_",
        '{"horario_de_recontacto_": 11}',
      ),
    });
    expect(out).toEqual({ horario_de_recontacto_: 11 });
  });

  it("boolean: conserva el booleano (YES_NO)", () => {
    const out = parseExecutedActions({
      info_extractor_necesita_subsidio: {
        ...action("necesita_subsidio", '{"necesita_subsidio": false}'),
        name: "info_extractor_necesita_subsidio",
      },
    });
    expect(out).toEqual({ necesita_subsidio: false });
  });

  it("objeto anidado: se guarda completo, no aplanado", () => {
    const out = parseExecutedActions({
      extract_info_enviar_informacion_de_llamada: action(
        "enviar_informacion_de_llamada",
        '{"enviar_informacion_de_llamada": {"nombre_cliente": "Enrique Ruiz", "numero_contacto": "3003649578", "tipo_inmueble": "apartamento"}}',
      ),
    });
    expect(out).toEqual({
      enviar_informacion_de_llamada: {
        nombre_cliente: "Enrique Ruiz",
        numero_contacto: "3003649578",
        tipo_inmueble: "apartamento",
      },
    });
  });

  it("objeto anidado en DOS niveles (visto en producción)", () => {
    const out = parseExecutedActions({
      extract_info_enviar_informacion_de_llamada: action(
        "enviar_informacion_de_llamada",
        '{"enviar_informacion_de_llamada": {"cliente": "Brandon", "detalles_inmueble": {"conjunto": "Porto Tres"}}}',
      ),
    });
    expect(
      (out.enviar_informacion_de_llamada as Record<string, unknown>).detalles_inmueble,
    ).toEqual({ conjunto: "Porto Tres" });
  });

  it("`{}` (no se extrajo nada): se OMITE la clave en vez de guardar null", () => {
    const out = parseExecutedActions({
      extract_info_enviar_informacion_de_llamada: action("enviar_informacion_de_llamada", "{}"),
    });
    expect(out).toEqual({});
  });

  it("valor null explícito: también se omite", () => {
    const out = parseExecutedActions({
      extract_info_enviar_informacion_de_llamada: action(
        "enviar_informacion_de_llamada",
        '{"enviar_informacion_de_llamada": null}',
      ),
    });
    expect(out).toEqual({});
  });

  it("unicode escapado se decodifica al parsear", () => {
    const out = parseExecutedActions({
      extract_info_zona: action("zona", '{"zona": "Santa B\\u00e1rbara"}'),
    });
    expect(out).toEqual({ zona: "Santa Bárbara" });
  });
});

describe("parseExecutedActions — robustez", () => {
  it("identifier CON ESPACIOS: se resuelve por la clave interna, no por la externa", () => {
    // Real: `info_extractor_nombre y apellido`.
    const out = parseExecutedActions({
      "info_extractor_nombre y apellido": {
        ...action("nombre y apellido", '{"nombre y apellido": "Laura Caicedo"}'),
        name: "info_extractor_nombre y apellido",
        parameters_hard_coded: hard("nombre y apellido"),
      },
    });
    expect(out).toEqual({ "nombre y apellido": "Laura Caicedo" });
  });

  it("ignora las acciones que no son extractores (custom_function)", () => {
    const out = parseExecutedActions({
      alguna_funcion: {
        name: "alguna_funcion",
        action_type: "custom_function_action_type",
        return_value: '{"algo": "no-extractor"}',
      },
    });
    expect(out).toEqual({});
  });

  it("return_value ilegible NO tumba el parseo del resto", () => {
    const out = parseExecutedActions({
      extract_info_roto: action("roto", "{esto no es json"),
      extract_info_bueno: action("bueno", '{"bueno": "ok"}'),
    });
    expect(out.bueno).toBe("ok");
    expect(out).toHaveProperty("roto"); // se conserva el crudo antes que perder el dato
  });

  it("tolera return_value ya parseado como objeto (por si cambian la API)", () => {
    const out = parseExecutedActions({
      extract_info_producto: {
        ...action("producto", ""),
        return_value: { producto: "Colágeno" } as unknown as string,
      },
    });
    expect(out).toEqual({ producto: "Colágeno" });
  });

  it("entradas basura devuelven objeto vacío, nunca lanzan", () => {
    expect(parseExecutedActions(null)).toEqual({});
    expect(parseExecutedActions(undefined)).toEqual({});
    expect(parseExecutedActions("nope")).toEqual({});
    expect(parseExecutedActions([1, 2, 3])).toEqual({});
    expect(parseExecutedActions({ x: null })).toEqual({});
  });

  it("varios extractores en una misma llamada", () => {
    const out = parseExecutedActions({
      extract_info_telefonocelular: action("telefonocelular", '{"telefonocelular": "3103565492"}'),
      extract_info_info_tipodenegocio: action(
        "info_tipodenegocio",
        '{"info_tipodenegocio": "Arriendo"}',
      ),
      extract_info_vacio: action("vacio", "{}"),
    });
    expect(out).toEqual({ telefonocelular: "3103565492", info_tipodenegocio: "Arriendo" });
  });
});

describe("formatExtractedValue", () => {
  it("formatea escalares", () => {
    expect(formatExtractedValue("Colágeno")).toBe("Colágeno");
    expect(formatExtractedValue(11)).toBe("11");
    expect(formatExtractedValue(true)).toBe("Sí");
    expect(formatExtractedValue(false)).toBe("No");
    expect(formatExtractedValue(null)).toBe("—");
    expect(formatExtractedValue("   ")).toBe("—");
  });

  it("aplana objetos anidados a una línea legible", () => {
    expect(
      formatExtractedValue({ nombre_cliente: "Enrique Ruiz", tipo_inmueble: "apartamento" }),
    ).toBe("nombre_cliente: Enrique Ruiz, tipo_inmueble: apartamento");
  });

  it("aplana dos niveles", () => {
    expect(formatExtractedValue({ detalles: { conjunto: "Porto Tres" } })).toBe(
      "detalles: conjunto: Porto Tres",
    );
  });
});

describe("humanizeIdentifier", () => {
  it("convierte snake_case en etiqueta legible", () => {
    expect(humanizeIdentifier("metodo_pago")).toBe("Metodo pago");
    expect(humanizeIdentifier("horario_de_recontacto_")).toBe("Horario de recontacto");
    expect(humanizeIdentifier("nombre y apellido")).toBe("Nombre y apellido");
  });
});

/**
 * Traer lo que YA existe en Synthflow (ADR-0085). La forma de abajo es la que
 * documenta `GET /v2/actions/{id}` y la que se verificó contra la cuenta real
 * (docs/25 §2.4): el `description` que mandamos vuelve como
 * `parameters_hard_coded.condition` y el `name` se lo inventa Synthflow.
 */
describe("parseActionExtractor", () => {
  const action = {
    action_id: "36b0e74a-1111-2222-3333-444455556666",
    action_type: "INFORMATION_EXTRACTOR",
    name: "info_extractor_metodo_pago",
    description: "",
    parameters_hard_coded: {
      type: "SINGLE_CHOICE",
      identifier: "metodo_pago",
      condition: "Metodo de pago que prefiere",
      choices: ["contra entrega", "addi", "transferencia"],
      examples: [],
    },
  };

  it("trae el extractor con su action_id, tipo y opciones", () => {
    expect(parseActionExtractor(action)).toEqual({
      actionId: "36b0e74a-1111-2222-3333-444455556666",
      identifier: "metodo_pago",
      type: "SINGLE_CHOICE",
      condition: "Metodo de pago que prefiere",
      choices: ["contra entrega", "addi", "transferencia"],
      examples: [],
    });
  });

  it("acepta `parameters_hard_coded` como STRING con JSON adentro", () => {
    const parsed = parseActionExtractor({
      ...action,
      parameters_hard_coded: JSON.stringify(action.parameters_hard_coded),
    });
    expect(parsed?.identifier).toBe("metodo_pago");
    expect(parsed?.choices).toHaveLength(3);
  });

  it("un tipo desconocido cae en respuesta abierta, no rompe la traída", () => {
    const parsed = parseActionExtractor({
      ...action,
      parameters_hard_coded: { ...action.parameters_hard_coded, type: "LO_QUE_SEA" },
    });
    expect(parsed?.type).toBe("OPEN_QUESTION");
  });

  it("deduce el identifier del nombre generado cuando no viene en los parámetros", () => {
    const parsed = parseActionExtractor({
      ...action,
      parameters_hard_coded: { condition: "Direccion de entrega" },
      name: "extract_info_direccion",
    });
    expect(parsed?.identifier).toBe("direccion");
  });

  it("cae al `description` de la acción si no hay `condition`", () => {
    const parsed = parseActionExtractor({
      ...action,
      description: "Get information with question: Extrae el telefono",
      parameters_hard_coded: { identifier: "telefono" },
    });
    expect(parsed?.condition).toBe("Get information with question: Extrae el telefono");
  });

  it("ignora lo que NO es un extractor: SMS, transferencias y funciones", () => {
    expect(
      parseActionExtractor({
        action_id: "x",
        action_type: "SEND_SMS",
        name: "sms_recordatorio",
        parameters_hard_coded: { message: "hola" },
      }),
    ).toBeNull();
    expect(parseActionExtractor(null)).toBeNull();
    expect(parseActionExtractor({})).toBeNull();
  });
});
