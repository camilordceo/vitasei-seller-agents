/**
 * Tipos compartidos entre el compositor del chat (client) y las Server Actions.
 * Van en su propio módulo porque `app/dashboard/actions.ts` es `"use server"`
 * (solo puede exportar funciones async).
 */

/** Producto del catálogo del agente, listo para adjuntar su foto al chat. */
export interface ProductPick {
  sku: string;
  name: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  inStock: boolean;
}
