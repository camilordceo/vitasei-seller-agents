import { describe, expect, it } from "vitest";
import { matchAgent, type AgentRoute } from "./routing";

const co: AgentRoute & { id: string } = {
  id: "co",
  callbell_channel_uuid: "chan-co",
  whatsapp_number: "573332877350",
  enabled: true,
};
const mx: AgentRoute & { id: string } = {
  id: "mx",
  callbell_channel_uuid: "chan-mx",
  whatsapp_number: "5215555555555",
  enabled: true,
};

describe("matchAgent", () => {
  it("elige por channel_uuid (primario)", () => {
    const r = matchAgent([co, mx], { channelUuid: "chan-mx", number: null });
    expect(r?.id).toBe("mx");
  });

  it("elige por número si no hay match de canal", () => {
    const r = matchAgent([co, mx], { channelUuid: "otro", number: "573332877350" });
    expect(r?.id).toBe("co");
  });

  it("prioriza canal sobre número", () => {
    const r = matchAgent([co, mx], { channelUuid: "chan-co", number: "5215555555555" });
    expect(r?.id).toBe("co");
  });

  it("ignora agentes deshabilitados", () => {
    const r = matchAgent([{ ...mx, enabled: false }], { channelUuid: "chan-mx", number: null });
    expect(r).toBeNull();
  });

  it("null si ninguno coincide", () => {
    const r = matchAgent([co, mx], { channelUuid: "x", number: "y" });
    expect(r).toBeNull();
  });

  it("no matchea nulls contra nulls del inbound", () => {
    const r = matchAgent([{ ...co, callbell_channel_uuid: null }], {
      channelUuid: null,
      number: null,
    });
    expect(r).toBeNull();
  });
});
