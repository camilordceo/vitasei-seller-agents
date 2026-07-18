import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifySynthflowSignature, readSignatureHeader } from "./signature";

/**
 * Synthflow firma el **`call_id`**, no el cuerpo (ADR-0061). Estos tests fijan
 * ese contrato —y su consecuencia: la firma autentica al emisor, no da
 * integridad del payload— para que nadie "arregle" el verificador firmando el
 * body y rompa el webhook en producción.
 */

const SECRET = "s3cr3t";
const CALL_ID = "58bd0d3f-6982-4a6d-911e-1c11fbcc7dca";
const sign = (value: string, secret = SECRET) =>
  createHmac("sha256", secret).update(value).digest("base64");

describe("verifySynthflowSignature", () => {
  it("acepta la firma base64 del call_id", () => {
    expect(verifySynthflowSignature(CALL_ID, sign(CALL_ID), SECRET)).toBe(true);
  });

  it("acepta también hex (la doc solo fija base64 por un ejemplo)", () => {
    const hex = createHmac("sha256", SECRET).update(CALL_ID).digest("hex");
    expect(verifySynthflowSignature(CALL_ID, hex, SECRET)).toBe(true);
  });

  it("rechaza la firma de OTRO call_id", () => {
    expect(verifySynthflowSignature(CALL_ID, sign("otro-call-id"), SECRET)).toBe(false);
  });

  it("rechaza con secreto equivocado", () => {
    expect(verifySynthflowSignature(CALL_ID, sign(CALL_ID, "otro"), SECRET)).toBe(false);
  });

  it("NO valida contra el cuerpo: se firma el call_id, no el payload", () => {
    const body = JSON.stringify({ call: { call_id: CALL_ID } });
    expect(verifySynthflowSignature(CALL_ID, sign(body), SECRET)).toBe(false);
  });

  it("rechaza entradas vacías sin lanzar", () => {
    expect(verifySynthflowSignature(CALL_ID, null, SECRET)).toBe(false);
    expect(verifySynthflowSignature(CALL_ID, "", SECRET)).toBe(false);
    expect(verifySynthflowSignature(CALL_ID, sign(CALL_ID), "")).toBe(false);
    expect(verifySynthflowSignature("", sign(CALL_ID), SECRET)).toBe(false);
  });

  it("tolera espacios alrededor de la firma", () => {
    expect(verifySynthflowSignature(CALL_ID, `  ${sign(CALL_ID)}  `, SECRET)).toBe(true);
  });
});

describe("readSignatureHeader", () => {
  it("lee la grafía más probable del cable", () => {
    const h = new Headers({ "Synthflow-Signature": "abc" });
    expect(readSignatureHeader(h)).toBe("abc");
  });

  it("acepta la grafía WSGI que aparece en la doc", () => {
    // La doc escribe `HTTP_SYNTHFLOW_SIGNATURE`, que es una variable de entorno
    // de WSGI, no un header. Aceptamos ambas para no depender de adivinar.
    expect(readSignatureHeader(new Headers({ HTTP_SYNTHFLOW_SIGNATURE: "abc" }))).toBe("abc");
    expect(readSignatureHeader(new Headers({ "x-synthflow-signature": "abc" }))).toBe("abc");
  });

  it("devuelve null si no hay firma", () => {
    expect(readSignatureHeader(new Headers({ "content-type": "application/json" }))).toBeNull();
    expect(readSignatureHeader(new Headers({ "synthflow-signature": "   " }))).toBeNull();
  });
});
