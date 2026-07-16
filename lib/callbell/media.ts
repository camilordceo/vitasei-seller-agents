/**
 * Re-export de los helpers de media, que ahora viven en `lib/messaging/media.ts`
 * (son puros y comunes a Callbell y Kapso; ver ADR-0056). Este módulo se conserva
 * para no tocar a quien ya los importaba desde acá.
 */
export {
  extFromUrl,
  filenameFor,
  kindFromContentType,
  normalizeContentType,
  toDataUrl,
  type FetchedMedia,
  type MediaKind,
} from "@/lib/messaging/media";
