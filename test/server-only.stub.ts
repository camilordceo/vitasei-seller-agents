// Stub de `server-only` para los tests. El paquete real lanza si se importa
// fuera de un Server Component; en Vitest lo aliasamos a este módulo vacío para
// poder unit-testear módulos server (que lo importan solo como guard de runtime).
export {};
