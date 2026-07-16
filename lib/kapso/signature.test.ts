import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyKapsoSignature } from "./signature";

const SECRET = "un-secreto-de-webhook";
const sign = (payload: string, secret = SECRET) =>
  createHmac("sha256", secret).update(payload, "utf8").digest("hex");

describe("verifyKapsoSignature", () => {
  const raw = '{"message":{"id":"wamid.123"},"phone_number_id":"1"}';

  it("acepta la firma del cuerpo crudo (lo que dice la prosa de la doc)", () => {
    expect(verifyKapsoSignature(raw, sign(raw), SECRET)).toBe(true);
  });

  it("acepta la firma de la re-serialización (lo que hacen los EJEMPLOS de la doc)", () => {
    // La doc se contradice: dice "raw payload" pero sus ejemplos firman
    // JSON.stringify(req.body). Acá el crudo trae espacios, así que las dos formas
    // difieren y solo pasa si de verdad probamos la segunda variante.
    const spaced = '{ "message": { "id": "wamid.123" }, "phone_number_id": "1" }';
    const restringified = JSON.stringify(JSON.parse(spaced));
    expect(restringified).not.toBe(spaced);
    expect(verifyKapsoSignature(spaced, sign(restringified), SECRET)).toBe(true);
  });

  it("tolera el prefijo sha256= y las mayúsculas", () => {
    expect(verifyKapsoSignature(raw, `sha256=${sign(raw).toUpperCase()}`, SECRET)).toBe(true);
  });

  it("rechaza una firma de otro secreto", () => {
    expect(verifyKapsoSignature(raw, sign(raw, "otro-secreto"), SECRET)).toBe(false);
  });

  it("rechaza si el cuerpo fue alterado", () => {
    const firma = sign(raw);
    const alterado = raw.replace("wamid.123", "wamid.999");
    expect(verifyKapsoSignature(alterado, firma, SECRET)).toBe(false);
  });

  it("rechaza firma ausente, vacía o basura", () => {
    expect(verifyKapsoSignature(raw, null, SECRET)).toBe(false);
    expect(verifyKapsoSignature(raw, "", SECRET)).toBe(false);
    expect(verifyKapsoSignature(raw, "no-es-hex", SECRET)).toBe(false);
    expect(verifyKapsoSignature(raw, "aabb", SECRET)).toBe(false); // largo distinto
  });

  it("rechaza si no hay secreto (el llamador decide si validar o no)", () => {
    expect(verifyKapsoSignature(raw, sign(raw), "")).toBe(false);
  });

  it("no revienta con un cuerpo que no es JSON", () => {
    expect(verifyKapsoSignature("no soy json", sign("no soy json"), SECRET)).toBe(true);
    expect(verifyKapsoSignature("no soy json", sign("otra cosa"), SECRET)).toBe(false);
  });
});
