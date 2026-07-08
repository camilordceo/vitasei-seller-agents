"use client";

import { useState, useTransition } from "react";
import { setConversationProductCategory } from "../../actions";

/**
 * Editor de la fuente/producto de la conversación. Autocompleta con las palabras
 * conocidas (`suggestions`) pero permite escribir cualquiera. Guarda con la server
 * action `setConversationProductCategory`. Ver docs/21.
 */
export function ProductCategoryEditor({
  conversationId,
  initial,
  suggestions,
}: {
  conversationId: string;
  initial: string | null;
  suggestions: string[];
}) {
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty = value.trim() !== saved.trim();
  const listId = `pc-${conversationId}`;

  const save = () => {
    startTransition(async () => {
      try {
        const v = value.trim();
        await setConversationProductCategory(conversationId, v || null);
        setSaved(v);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar la categoría.");
      }
    });
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          list={listId}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ej: magnesio"
          className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <button
          onClick={save}
          disabled={isPending || !dirty}
          className="h-9 shrink-0 rounded-md bg-slate-900 px-3 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50"
        >
          {isPending ? "…" : "Guardar"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
