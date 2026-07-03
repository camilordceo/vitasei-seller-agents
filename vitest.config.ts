import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Config de Vitest. Resuelve el alias `@/` igual que `tsconfig.json` para que
 * los tests importen módulos del proyecto. Los tests cubren lógica PURA
 * (sin I/O), por eso `environment: node` basta.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // `server-only` lanza fuera de un Server Component; en tests lo
      // neutralizamos para poder unit-testear módulos server que lo importan
      // como guard (p.ej. `lib/openai/responses.ts`).
      "server-only": fileURLToPath(new URL("./test/server-only.stub.ts", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
