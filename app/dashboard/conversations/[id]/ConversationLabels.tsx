"use client";

import { useState, useTransition } from "react";
import {
  type Label,
  getLabels,
  getConversationLabels,
  addLabelToConversation,
  removeLabelFromConversation,
  createLabel,
} from "../../actions";

// Colores predefinidos para nuevas etiquetas
const PRESET_COLORS = [
  { name: "Gris", hex: "#6B7280" },
  { name: "Rojo", hex: "#EF4444" },
  { name: "Amarillo", hex: "#F59E0B" },
  { name: "Verde", hex: "#10B981" },
  { name: "Azul", hex: "#3B82F6" },
  { name: "Morado", hex: "#8B5CF6" },
  { name: "Rosa", hex: "#EC4899" },
];

interface ConversationLabelsProps {
  conversationId: string;
  agentId: string | null;
  initialLabels: Label[];
  initialAvailable: Label[];
}

export function ConversationLabels({
  conversationId,
  agentId,
  initialLabels,
  initialAvailable,
}: ConversationLabelsProps) {
  const [labels, setLabels] = useState<Label[]>(initialLabels);
  const [available, setAvailable] = useState<Label[]>(initialAvailable);
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6B7280");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleAdd = (label: Label) => {
    startTransition(async () => {
      try {
        await addLabelToConversation(conversationId, label.id);
        setLabels((prev) => [...prev, label]);
        setIsOpen(false);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al agregar etiqueta");
      }
    });
  };

  const handleRemove = (labelId: string) => {
    startTransition(async () => {
      try {
        await removeLabelFromConversation(conversationId, labelId);
        setLabels((prev) => prev.filter((l) => l.id !== labelId));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al quitar etiqueta");
      }
    });
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    startTransition(async () => {
      try {
        const id = await createLabel({ name: newName.trim(), color: newColor, agentId });
        const newLabel: Label = { id, name: newName.trim(), color: newColor, agent_id: agentId };
        setAvailable((prev) => [...prev, newLabel]);
        setLabels((prev) => [...prev, newLabel]);
        await addLabelToConversation(conversationId, id);
        setNewName("");
        setNewColor("#6B7280");
        setIsCreating(false);
        setIsOpen(false);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al crear etiqueta");
      }
    });
  };

  // Etiquetas que aún no tiene esta conversación
  const notAssigned = available.filter((a) => !labels.some((l) => l.id === a.id));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Badges de etiquetas actuales */}
      {labels.map((label) => (
        <LabelBadge
          key={label.id}
          label={label}
          onRemove={() => handleRemove(label.id)}
          disabled={isPending}
        />
      ))}

      {/* Botón para agregar */}
      <div className="relative">
        <button
          onClick={() => {
            setIsOpen(!isOpen);
            setIsCreating(false);
          }}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:opacity-50"
        >
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
          </svg>
          Etiqueta
        </button>

        {/* Dropdown */}
        {isOpen && (
          <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
            {!isCreating ? (
              <>
                {/* Lista de etiquetas disponibles */}
                {notAssigned.length > 0 ? (
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {notAssigned.map((label) => (
                      <button
                        key={label.id}
                        onClick={() => handleAdd(label)}
                        disabled={isPending}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100 disabled:opacity-50"
                      >
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: label.color }}
                        />
                        {label.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="px-2 py-1 text-xs text-slate-400">Todas asignadas</p>
                )}

                <hr className="my-2 border-slate-200" />

                {/* Botón crear nueva */}
                <button
                  onClick={() => setIsCreating(true)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-100"
                >
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
                  </svg>
                  Crear nueva etiqueta
                </button>
              </>
            ) : (
              /* Formulario para crear */
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-600">Nombre</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ej: No interesado"
                    className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    autoFocus
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-600">Color</label>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c.hex}
                        type="button"
                        onClick={() => setNewColor(c.hex)}
                        className={`h-6 w-6 rounded-full border-2 ${
                          newColor === c.hex ? "border-slate-800" : "border-transparent"
                        }`}
                        style={{ backgroundColor: c.hex }}
                        title={c.name}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setIsCreating(false)}
                    className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={isPending || !newName.trim()}
                    className="flex-1 rounded-md bg-slate-800 px-2 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    {isPending ? "..." : "Crear"}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p className="mt-2 text-xs text-red-600">{error}</p>
            )}
          </div>
        )}
      </div>

      {/* Cerrar dropdown al hacer click fuera */}
      {isOpen && (
        <div
          className="fixed inset-0 z-0"
          onClick={() => {
            setIsOpen(false);
            setIsCreating(false);
          }}
        />
      )}
    </div>
  );
}

interface LabelBadgeProps {
  label: Label;
  onRemove?: () => void;
  disabled?: boolean;
}

export function LabelBadge({ label, onRemove, disabled }: LabelBadgeProps) {
  // Determinar si el texto debe ser claro u oscuro basado en el color de fondo
  const isLightColor = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
  };

  const textClass = isLightColor(label.color) ? "text-slate-800" : "text-white";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${textClass}`}
      style={{ backgroundColor: label.color }}
    >
      {label.name}
      {onRemove && (
        <button
          onClick={onRemove}
          disabled={disabled}
          className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 focus:outline-none disabled:opacity-50"
        >
          <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      )}
    </span>
  );
}
