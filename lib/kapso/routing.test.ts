import { describe, expect, it } from "vitest";
import { matchKapsoAgent, type KapsoAgentRoute } from "./routing";
import { matchAgent, type AgentRoute } from "@/lib/callbell/routing";

const kapsoAgent = (over: Partial<KapsoAgentRoute & { id: string }> = {}) => ({
  id: "kapso-1",
  kapso_phone_number_id: "123456789012345",
  enabled: true,
  provider: "kapso",
  ...over,
});

describe("matchKapsoAgent", () => {
  it("enruta por phone_number_id (lo único que identifica el número en Kapso)", () => {
    const agents = [kapsoAgent(), kapsoAgent({ id: "kapso-2", kapso_phone_number_id: "999" })];
    expect(matchKapsoAgent(agents, { phoneNumberId: "999" })?.id).toBe("kapso-2");
  });

  it("ignora los agentes deshabilitados", () => {
    expect(matchKapsoAgent([kapsoAgent({ enabled: false })], { phoneNumberId: "123456789012345" }))
      .toBeNull();
  });

  it("devuelve null si no es un número nuestro", () => {
    expect(matchKapsoAgent([kapsoAgent()], { phoneNumberId: "otro" })).toBeNull();
  });

  it("sin phone_number_id no enruta a nadie (no elige un agente al azar)", () => {
    expect(matchKapsoAgent([kapsoAgent()], { phoneNumberId: null })).toBeNull();
  });

  it("no confunde un phone_number_id nulo del agente con uno nulo del inbound", () => {
    expect(matchKapsoAgent([kapsoAgent({ kapso_phone_number_id: null })], { phoneNumberId: "123" }))
      .toBeNull();
  });

  it("NO enruta a un agente de Callbell aunque tenga pegado el mismo phone_number_id", () => {
    // El caso real de la prueba en paralelo: la misma marca cargada dos veces, una
    // por proveedor. Sin el filtro contestaríamos con las credenciales equivocadas.
    const callbellTwin = kapsoAgent({ id: "callbell-1", provider: "callbell" });
    expect(matchKapsoAgent([callbellTwin], { phoneNumberId: "123456789012345" })).toBeNull();
  });
});

describe("matchAgent (Callbell) frente a agentes de Kapso", () => {
  const callbellAgent = (over: Partial<AgentRoute & { id: string }> = {}) => ({
    id: "callbell-1",
    callbell_channel_uuid: "chan-1",
    whatsapp_number: "573332877350",
    enabled: true,
    ...over,
  });

  it("sigue enrutando a los agentes de Callbell (sin `provider` = histórico)", () => {
    expect(matchAgent([callbellAgent()], { channelUuid: "chan-1", number: null })?.id).toBe(
      "callbell-1",
    );
  });

  it("NO enruta a un agente de Kapso que comparta el número", () => {
    const kapsoTwin = callbellAgent({ id: "kapso-1", provider: "kapso", callbell_channel_uuid: null });
    expect(matchAgent([kapsoTwin], { channelUuid: null, number: "573332877350" })).toBeNull();
  });

  it("elige el de Callbell cuando ambos gemelos comparten número", () => {
    const agents = [
      callbellAgent({ id: "kapso-1", provider: "kapso", callbell_channel_uuid: null }),
      callbellAgent({ id: "callbell-1", provider: "callbell", callbell_channel_uuid: null }),
    ];
    expect(matchAgent(agents, { channelUuid: null, number: "573332877350" })?.id).toBe("callbell-1");
  });
});
