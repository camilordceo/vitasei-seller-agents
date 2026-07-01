import { describe, expect, it } from "vitest";
import {
  classifyInbox,
  getChannelUuid,
  getDestinationNumber,
  isInboundMessageEvent,
  normalizePhone,
} from "./types";

const AGENT = "573332877350";
const CH = "chan-ai-uuid";

describe("normalizePhone", () => {
  it("quita el '+' y no-dígitos", () => {
    expect(normalizePhone("+57 333 287 7350")).toBe("573332877350");
  });
  it("null/ vacío → null", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
});

describe("getDestinationNumber / getChannelUuid", () => {
  it("lee el número destino de `to` (normalizado)", () => {
    expect(getDestinationNumber({ to: "+573332877350" })).toBe("573332877350");
  });
  it("lee el número destino de channel.phoneNumber", () => {
    expect(getDestinationNumber({ channel: { phoneNumber: "573332877350" } })).toBe(
      "573332877350",
    );
  });
  it("lee el channel_uuid de varias rutas", () => {
    expect(getChannelUuid({ channelUuid: "x" })).toBe("x");
    expect(getChannelUuid({ channel_uuid: "y" })).toBe("y");
    expect(getChannelUuid({ channel: { uuid: "z" } })).toBe("z");
  });
});

describe("classifyInbox", () => {
  it("sin filtro configurado → match (dev)", () => {
    expect(classifyInbox({ to: "573000000000" }, undefined, undefined).decision).toBe("match");
  });

  it("match por número destino correcto", () => {
    expect(classifyInbox({ to: "573332877350" }, AGENT, CH).decision).toBe("match");
  });

  it("reject por número destino distinto", () => {
    expect(classifyInbox({ to: "573000000000" }, AGENT, CH).decision).toBe("reject");
  });

  it("fallback a channel_uuid cuando no viene número destino", () => {
    expect(classifyInbox({ channelUuid: CH }, AGENT, CH).decision).toBe("match");
    expect(classifyInbox({ channelUuid: "otro" }, AGENT, CH).decision).toBe("reject");
  });

  it("indeterminate si hay filtro pero el webhook no trae ni número ni canal", () => {
    expect(classifyInbox({ text: "hola" }, AGENT, CH).decision).toBe("indeterminate");
  });
});

describe("isInboundMessageEvent", () => {
  it("acepta message_created del cliente", () => {
    expect(isInboundMessageEvent({ event: "message_created", payload: { from: "contact" } })).toBe(
      true,
    );
  });
  it("rechaza outbound (from: bot)", () => {
    expect(isInboundMessageEvent({ event: "message_created", payload: { from: "bot" } })).toBe(
      false,
    );
  });
  it("rechaza otros eventos", () => {
    expect(isInboundMessageEvent({ event: "message_updated" })).toBe(false);
  });
});
