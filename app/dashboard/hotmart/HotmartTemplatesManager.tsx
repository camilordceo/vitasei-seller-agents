"use client";

import { useState, useTransition } from "react";
import {
  createHotmartTemplate,
  updateHotmartTemplate,
  deleteHotmartTemplate,
  setHotmartTemplateEnabled,
  type HotmartTemplateInput,
} from "../actions";
import type { HotmartTemplateRow } from "@/lib/dashboard/queries";
import { providerLabel, type MessagingProviderId } from "@/lib/messaging/types";

export type AgentOption = {
  id: string;
  name: string;
  brand: string | null;
  /** Proveedor del agente: define si `templateUuid` es un UUID o un nombre. Ver ADR-0056. */
  provider: MessagingProviderId;
};

const inputCls =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500";
const labelCls = "text-xs font-medium text-slate-600";

type FormState = {
  name: string;
  agentId: string;
  templateUuid: string;
  productId: string;
  messageText: string;
};

const emptyForm: FormState = {
  name: "",
  agentId: "",
  templateUuid: "",
  productId: "",
  messageText: "",
};

/** Campos compartidos por el formulario de crear y el de editar. */
function TemplateFields({
  value,
  onChange,
  agents,
  idPrefix,
}: {
  value: FormState;
  onChange: (patch: Partial<FormState>) => void;
  agents: AgentOption[];
  idPrefix: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor={`${idPrefix}-name`} className={labelCls}>
          Nombre
        </label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          value={value.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Carrito abandonado — Cursos"
          className={`mt-1 ${inputCls}`}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-agent`} className={labelCls}>
          Marca / agente
        </label>
        <select
          id={`${idPrefix}-agent`}
          value={value.agentId}
          onChange={(e) => onChange({ agentId: e.target.value })}
          className={`mt-1 ${inputCls}`}
        >
          <option value="">Global (todas las marcas)</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.brand ? ` · ${a.brand}` : ""} [{providerLabel(a.provider)}]
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-uuid`} className={labelCls}>
          Plantilla del proveedor
        </label>
        <input
          id={`${idPrefix}-uuid`}
          type="text"
          value={value.templateUuid}
          onChange={(e) => onChange({ templateUuid: e.target.value })}
          placeholder="UUID (Callbell) o nombre (Kapso)"
          className={`mt-1 font-mono ${inputCls}`}
        />
        {/* El campo es el mismo para los dos proveedores porque el dato cumple la
            misma función; lo que cambia es el formato. Ver ADR-0056. */}
        <p className="mt-1 text-xs text-slate-400">
          Según el proveedor del agente: en <strong>Callbell</strong> el UUID de la plantilla; en{" "}
          <strong>Kapso</strong> su nombre aprobado en Meta (p. ej.{" "}
          <code>carrito_abandonado</code>, o <code>carrito_abandonado:en_US</code> para forzar
          idioma).
        </p>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-product`} className={labelCls}>
          ID de producto Hotmart (opcional)
        </label>
        <input
          id={`${idPrefix}-product`}
          type="text"
          value={value.productId}
          onChange={(e) => onChange({ productId: e.target.value })}
          placeholder="Vacío = todos los productos"
          className={`mt-1 font-mono ${inputCls}`}
        />
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}-text`} className={labelCls}>
          Texto del mensaje
        </label>
        <textarea
          id={`${idPrefix}-text`}
          value={value.messageText}
          onChange={(e) => onChange({ messageText: e.target.value })}
          rows={3}
          placeholder="¡Hola {{nombre}}! Vimos que dejaste pendiente {{producto}}. ¿Te ayudo a completar tu compra?"
          className={`mt-1 ${inputCls}`}
        />
        <p className="mt-1 text-xs text-slate-400">
          Usa <code className="rounded bg-slate-100 px-1">{"{{nombre}}"}</code> y{" "}
          <code className="rounded bg-slate-100 px-1">{"{{producto}}"}</code>{" "}
          <strong>solo si tu plantilla aprobada en Callbell tiene esas variables</strong> (en ese
          orden). Si la plantilla es de <strong>solo texto</strong>, no pongas variables — se manda
          sin parámetros. El envío real usa la plantilla aprobada en Callbell.
        </p>
      </div>
    </div>
  );
}

/** Etiqueta de a quién aplica una plantilla (marca + producto). */
function scopeLabel(t: HotmartTemplateRow, agents: AgentOption[]): string {
  const agent = t.agentId ? agents.find((a) => a.id === t.agentId) : null;
  const brand = t.agentId ? (agent ? agent.name : "Agente") : "Global";
  const product = t.productId ? `producto ${t.productId}` : "todos los productos";
  return `${brand} · ${product}`;
}

export function HotmartTemplatesManager({
  initial,
  agents,
}: {
  initial: HotmartTemplateRow[];
  agents: AgentOption[];
}) {
  const [rows, setRows] = useState<HotmartTemplateRow[]>(initial);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState>(emptyForm);

  const toInput = (f: FormState): HotmartTemplateInput => ({
    name: f.name,
    templateUuid: f.templateUuid,
    messageText: f.messageText,
    productId: f.productId,
    agentId: f.agentId || null,
  });

  const handleCreate = () => {
    if (!form.name.trim()) return;
    startTransition(async () => {
      try {
        const id = await createHotmartTemplate(toInput(form));
        setRows((prev) => [
          {
            id,
            agentId: form.agentId || null,
            eventType: "PURCHASE_OUT_OF_SHOPPING_CART",
            productId: form.productId.trim() || null,
            name: form.name.trim(),
            templateUuid: form.templateUuid.trim() || null,
            messageText: form.messageText.trim() || null,
            enabled: true,
            createdAt: new Date().toISOString(),
          },
          ...prev,
        ]);
        setForm(emptyForm);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al crear la plantilla");
      }
    });
  };

  const startEdit = (t: HotmartTemplateRow) => {
    setEditingId(t.id);
    setEditForm({
      name: t.name,
      agentId: t.agentId ?? "",
      templateUuid: t.templateUuid ?? "",
      productId: t.productId ?? "",
      messageText: t.messageText ?? "",
    });
    setError(null);
  };

  const handleSaveEdit = (id: string) => {
    if (!editForm.name.trim()) return;
    startTransition(async () => {
      try {
        await updateHotmartTemplate(id, toInput(editForm));
        setRows((prev) =>
          prev.map((x) =>
            x.id === id
              ? {
                  ...x,
                  name: editForm.name.trim(),
                  agentId: editForm.agentId || null,
                  templateUuid: editForm.templateUuid.trim() || null,
                  productId: editForm.productId.trim() || null,
                  messageText: editForm.messageText.trim() || null,
                }
              : x,
          ),
        );
        setEditingId(null);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar la plantilla");
      }
    });
  };

  const handleToggle = (t: HotmartTemplateRow) => {
    startTransition(async () => {
      try {
        await setHotmartTemplateEnabled(t.id, !t.enabled);
        setRows((prev) => prev.map((x) => (x.id === t.id ? { ...x, enabled: !x.enabled } : x)));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al actualizar la plantilla");
      }
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      try {
        await deleteHotmartTemplate(id);
        setRows((prev) => prev.filter((x) => x.id !== id));
        if (editingId === id) setEditingId(null);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al eliminar la plantilla");
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Crear */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">Agregar plantilla</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Al recibir un carrito abandonado, se envía la plantilla de Callbell que coincida con la
          marca (y el producto, si lo especificas).
        </p>
        <div className="mt-3">
          <TemplateFields
            value={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            agents={agents}
            idPrefix="new"
          />
        </div>
        <div className="mt-3 flex justify-end">
          <button
            onClick={handleCreate}
            disabled={isPending || !form.name.trim()}
            className="h-11 rounded-md bg-slate-900 px-5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
          >
            {isPending ? "Guardando…" : "Agregar"}
          </button>
        </div>
        {error && !editingId && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      </section>

      {/* Lista */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Plantillas configuradas{" "}
          <span className="font-normal text-slate-400">({rows.length})</span>
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">
            Aún no hay plantillas. Agrega una arriba. Mientras tanto, si tienes configurada la env
            <code className="mx-1 rounded bg-slate-100 px-1">HOTMART_ABANDONED_CART_TEMPLATE_UUID</code>
            se sigue usando esa.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((t) =>
              editingId === t.id ? (
                <li key={t.id} className="space-y-3 py-4">
                  <TemplateFields
                    value={editForm}
                    onChange={(patch) => setEditForm((f) => ({ ...f, ...patch }))}
                    agents={agents}
                    idPrefix={`edit-${t.id}`}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      disabled={isPending}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => handleSaveEdit(t.id)}
                      disabled={isPending || !editForm.name.trim()}
                      className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
                    >
                      {isPending ? "Guardando…" : "Guardar"}
                    </button>
                  </div>
                  {error && <p className="text-xs text-rose-600">{error}</p>}
                </li>
              ) : (
                <li key={t.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-800">{t.name}</span>
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {scopeLabel(t, agents)}
                      </span>
                      {!t.enabled && (
                        <span className="text-xs font-medium text-slate-400">Desactivada</span>
                      )}
                      {!t.templateUuid && (
                        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          Sin UUID (no envía)
                        </span>
                      )}
                    </div>
                    {t.messageText && (
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500" title={t.messageText}>
                        “{t.messageText}”
                      </p>
                    )}
                    {t.templateUuid && (
                      <p className="mt-0.5 truncate font-mono text-xs text-slate-400" title={t.templateUuid}>
                        {t.templateUuid}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => startEdit(t)}
                      disabled={isPending}
                      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleToggle(t)}
                      disabled={isPending}
                      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
                    >
                      {t.enabled ? "Desactivar" : "Activar"}
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
                      disabled={isPending}
                      className="rounded-md border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50"
                    >
                      Eliminar
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
