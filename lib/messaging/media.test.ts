import { describe, expect, it } from "vitest";
import {
  extFromUrl,
  filenameFor,
  kindFromContentType,
  normalizeContentType,
  toDataUrl,
} from "./media";

describe("extFromUrl", () => {
  it("saca la extensión del path (minúsculas)", () => {
    expect(extFromUrl("https://cdn.callbell.eu/a/b/voz.ogg")).toBe("ogg");
    expect(extFromUrl("https://x/y/foto.JPG?token=1")).toBe("jpg");
  });
  it("vacío si no hay extensión", () => {
    expect(extFromUrl("https://x/y/archivo")).toBe("");
  });
});

describe("normalizeContentType", () => {
  it("usa el header si es útil (ignora el charset)", () => {
    expect(normalizeContentType("image/jpeg; charset=binary", "https://x/y.bin")).toBe(
      "image/jpeg",
    );
  });
  it("infiere de la extensión si el header es genérico o falta", () => {
    expect(normalizeContentType("application/octet-stream", "https://x/y/voz.ogg")).toBe(
      "audio/ogg",
    );
    expect(normalizeContentType(null, "https://x/y/foto.png")).toBe("image/png");
  });
  it("cae a octet-stream si no hay pistas", () => {
    expect(normalizeContentType(null, "https://x/y/archivo")).toBe("application/octet-stream");
  });
});

describe("kindFromContentType", () => {
  it("clasifica por top-level type", () => {
    expect(kindFromContentType("image/png")).toBe("image");
    expect(kindFromContentType("audio/ogg")).toBe("audio");
    expect(kindFromContentType("video/mp4")).toBe("video");
    expect(kindFromContentType("application/pdf")).toBe("document");
    expect(kindFromContentType("application/zip")).toBe("other");
  });
});

describe("filenameFor", () => {
  it("nombra audio con extensión del content-type", () => {
    expect(filenameFor("audio/ogg", "https://x/y/nota")).toBe("audio.ogg");
    expect(filenameFor("audio/mpeg", "https://x/y/nota.mp3")).toBe("audio.mp3");
  });
  it("nombra media no-audio como 'media'", () => {
    expect(filenameFor("image/jpeg", "https://x/y/f.jpg")).toBe("media.jpg");
  });
});

describe("toDataUrl", () => {
  it("arma un data URL base64", () => {
    const bytes = new Uint8Array([104, 105]); // "hi"
    expect(toDataUrl(bytes, "image/png")).toBe("data:image/png;base64,aGk=");
  });
});
