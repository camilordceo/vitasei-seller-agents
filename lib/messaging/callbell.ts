import "server-only";
import {
  sendText as callbellSendText,
  sendImage as callbellSendImage,
  sendVideo as callbellSendVideo,
  sendTemplate as callbellSendTemplate,
  credsFromEnv,
  type CallbellCreds,
} from "@/lib/callbell/sender";
import type {
  MessagingProvider,
  SendOptions,
  SendTemplateOptions,
  SentMessage,
  TemplateRef,
} from "@/lib/messaging/types";

/**
 * Adaptador de Callbell — envoltura DELGADA sobre `lib/callbell/sender.ts`.
 *
 * A propósito no reimplementa nada: delega en el sender que ya está en producción,
 * así el comportamiento en el cable (payloads, plantillas con/sin imagen, handoff)
 * es **idéntico** al de antes de ADR-0056. Si esta clase se borrara, Callbell
 * seguiría funcionando llamando al sender directo.
 *
 * `templateRef` = el `uuid` de la plantilla en la cuenta de Callbell del agente.
 */
export class CallbellProvider implements MessagingProvider {
  readonly id = "callbell" as const;
  /** Callbell sí sabe reasignar a un equipo y apagar su bot (`team_uuid` + `bot_status`). */
  readonly supportsHandoff = true;

  constructor(private readonly creds: CallbellCreds) {}

  sendText(to: string, text: string, options?: SendOptions): Promise<SentMessage> {
    return callbellSendText(this.creds, to, text, options);
  }

  sendImage(
    to: string,
    url: string,
    caption?: string | null,
    options?: SendOptions,
  ): Promise<SentMessage> {
    return callbellSendImage(this.creds, to, url, caption, options);
  }

  sendVideo(
    to: string,
    url: string,
    caption?: string | null,
    options?: SendOptions,
  ): Promise<SentMessage> {
    return callbellSendVideo(this.creds, to, url, caption, options);
  }

  sendTemplate(
    to: string,
    template: TemplateRef,
    options?: SendTemplateOptions,
  ): Promise<SentMessage> {
    return callbellSendTemplate(this.creds, to, template, options);
  }
}

/** Adaptador de Callbell con las credenciales globales de env (fallback single-agent). */
export function callbellProviderFromEnv(): CallbellProvider {
  return new CallbellProvider(credsFromEnv());
}
