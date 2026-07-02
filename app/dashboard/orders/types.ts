import type { FulfillmentMethod, OrderStatus } from "@/lib/supabase/types";

/**
 * Tipos compartidos entre el editor (client) y la Server Action `saveOrder`.
 * Van en su propio módulo porque `app/dashboard/actions.ts` es `"use server"`
 * (solo puede exportar funciones async) y el editor es `"use client"`.
 */

export interface OrderItemInput {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number | null;
}

export interface OrderEditInput {
  status: OrderStatus;
  method: FulfillmentMethod;
  shippingName: string;
  shippingAddress: string;
  shippingCity: string;
  shippingPhone: string;
  notes: string;
  /** Total manual; se ignora si `recomputeTotal` es true. */
  total: number | null;
  /** Recalcular el total sumando qty × precio de los ítems. */
  recomputeTotal: boolean;
  items: OrderItemInput[];
}
