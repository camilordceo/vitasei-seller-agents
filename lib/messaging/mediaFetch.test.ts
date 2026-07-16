import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchMedia, type MediaAuth } from "./mediaFetch";

/**
 * El punto crítico de `fetchMedia` es a QUÉ host se le manda la credencial.
 *
 * La URL del adjunto viene del webhook, así que un atacante que logre inyectar una
 * URL suya y responder 401 se lleva la API key del proveedor. El guardia original
 * probaba el patrón contra la URL COMPLETA, y eso se burla con un query param
 * (`https://atacante.com/x?ref=callbell`). Ahora se prueba contra el hostname.
 */

const auth: MediaAuth = {
  header: "X-API-Key",
  value: "SECRETO",
  hostPattern: /^(.+\.)?kapso\.ai$/i,
};

/** 401 en el intento anónimo (fuerza la rama de credencial) y 200 en el reintento. */
function mockFetch401Then200() {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 401, headers: new Headers() })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/jpeg" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** ¿Se mandó la credencial en algún intento? */
const sentSecret = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.some((c) => JSON.stringify(c[1]?.headers ?? {}).includes("SECRETO"));

afterEach(() => vi.unstubAllGlobals());

describe("fetchMedia — a quién se le manda la credencial", () => {
  it("se la manda al host del proveedor cuando responde 401", async () => {
    const fetchMock = mockFetch401Then200();
    const media = await fetchMedia("https://api.kapso.ai/media/abc", { auth });
    expect(sentSecret(fetchMock)).toBe(true);
    expect(media?.kind).toBe("image");
  });

  it("NO se la manda a un host ajeno que mete el dominio en el query (el agujero)", async () => {
    const fetchMock = mockFetch401Then200();
    await fetchMedia("https://atacante.example/x?next=//kapso.ai/a", { auth });
    expect(sentSecret(fetchMock)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // ni siquiera reintenta
  });

  it("NO se la manda a un host ajeno que mete el dominio en el path", async () => {
    const fetchMock = mockFetch401Then200();
    await fetchMedia("https://atacante.example/api.kapso.ai/media/abc", { auth });
    expect(sentSecret(fetchMock)).toBe(false);
  });

  it("NO se la manda a un dominio que solo TERMINA parecido", async () => {
    const fetchMock = mockFetch401Then200();
    await fetchMedia("https://kapso.ai.atacante.example/media/abc", { auth });
    expect(sentSecret(fetchMock)).toBe(false);
  });

  it("NO se la manda a un dominio que solo EMPIEZA parecido", async () => {
    const fetchMock = mockFetch401Then200();
    await fetchMedia("https://kapso.ai-atacante.example/media/abc", { auth });
    expect(sentSecret(fetchMock)).toBe(false);
  });

  it("sin `auth` nunca reintenta", async () => {
    const fetchMock = mockFetch401Then200();
    expect(await fetchMedia("https://api.kapso.ai/media/abc")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("una descarga anónima que funciona no toca la credencial", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    });
    vi.stubGlobal("fetch", fetchMock);
    // El valor es un thunk que revienta: prueba que NI SIQUIERA se evalúa el secreto
    // si no hace falta (`env.CALLBELL_API_KEY` lanza cuando la variable no está).
    const explosivo: MediaAuth = {
      header: "Authorization",
      value: () => {
        throw new Error("no debería evaluarse");
      },
      hostPattern: /kapso/i,
    };
    const media = await fetchMedia("https://api.kapso.ai/media/x", { auth: explosivo });
    expect(media?.kind).toBe("image");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("una URL no parseable no arriesga el secreto", async () => {
    const fetchMock = mockFetch401Then200();
    await fetchMedia("no-soy-una-url", { auth });
    expect(sentSecret(fetchMock)).toBe(false);
  });
});
