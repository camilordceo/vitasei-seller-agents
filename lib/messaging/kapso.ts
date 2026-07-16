import "server-only";
import {
  sendText as kapsoSendText,
  sendImage as kapsoSendImage,
  sendVideo as kapsoSendVideo,
  sendTemplate as kapsoSendTemplate,
  type KapsoCreds,
} from "@/lib/kapso/sender";
import type {
  MessagingProvider,
  SendOptions,
  SendTemplateOptions,
  SentMessage,
  TemplateRef,
} from "@/lib/messaging/types";

/**
 * Adaptador de Kapso. Traduce el puerto al sender Meta-compatible.
 *
 * Qué se pierde respecto de Callbell (documentado, no accidental — ver docs/24):
 *  - **`metadata`**: Kapso no documenta un campo equivalente y mandar uno inventado
 *    arriesga un 400 en la ruta crítica. La trazabilidad ya vive en `events_log`.
 *  - **Handoff nativo** (`teamUuid` + `botStatus`): Kapso no tiene equipos ni bot
 *    propio que apagar. `supportsHandoff = false`. El handoff SIGUE funcionando: lo
 *    que calla a nuestra IA es `conversations.status = 'handed_off'` (lo pone el
 *    cerebro), no el proveedor. Lo que no ocurre es la reasignación en una bandeja
 *    del proveedor. Ver ADR-0056 §Handoff.
 */
export class KapsoProvider implements MessagingProvider {
  readonly id = "kapso" as const;
  readonly supportsHandoff = false;

  constructor(private readonly creds: KapsoCreds) {}

  sendText(to: string, text: string, _options?: SendOptions): Promise<SentMessage> {
    return kapsoSendText(this.creds, to, text);
  }

  sendImage(
    to: string,
    url: string,
    caption?: string | null,
    _options?: SendOptions,
  ): Promise<SentMessage> {
    return kapsoSendImage(this.creds, to, url, caption);
  }

  sendVideo(
    to: string,
    url: string,
    caption?: string | null,
    _options?: SendOptions,
  ): Promise<SentMessage> {
    return kapsoSendVideo(this.creds, to, url, caption);
  }

  sendTemplate(
    to: string,
    template: TemplateRef,
    options?: SendTemplateOptions,
  ): Promise<SentMessage> {
    return kapsoSendTemplate(this.creds, to, template, {
      templateValues: templateValuesFor(options),
      imageUrl: options?.imageUrl,
    });
  }
}

/**
 * Variables del cuerpo para Kapso. Existe por una asimetría heredada de Callbell:
 * allí, una plantilla de UNA sola variable se manda con el valor en `content.text`
 * y sin `template_values` (su convención). Los llamadores adoptaron esa forma:
 *
 *  - Reactivaciones (`lib/agent/reactivation.ts`) pasan solo `text` = el nombre.
 *  - Hotmart (`lib/hotmart/processEvent.ts`) pasa `templateValues` explícito, que
 *    puede ser `[]` a propósito (plantilla de solo texto: mandarle parámetros de
 *    más la haría fallar).
 *
 * Kapso no tiene esa convención: TODA variable va en `components[].parameters`. Así
 * que se traduce acá y no en los llamadores, para no tocar el camino de Callbell
 * (que hoy factura) por un detalle del otro proveedor:
 *  - `templateValues` definido (incluido `[]`) → se respeta tal cual.
 *  - `templateValues` ausente → se usa `text` como la única variable.
 */
function templateValuesFor(options?: SendTemplateOptions): string[] {
  if (options?.templateValues !== undefined) return options.templateValues;
  return options?.text ? [options.text] : [];
}
