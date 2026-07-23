import "server-only";

/**
 * Cliente HTTP de PayPal (Invoicing v2) — genera el link de pago de una orden.
 *
 * Flujo (4 llamadas): OAuth (client credentials) → crear invoice (draft) →
 * enviarlo con `send_to_recipient: false` (lo vuelve UNPAID **sin** mandar email:
 * el link se comparte por WhatsApp) → leer `detail.metadata.recipient_view_url`,
 * que es el link pagable con PayPal o tarjeta. Ver ADR-0088.
 */

export interface PaypalCreds {
  clientId: string;
  clientSecret: string;
  sandbox: boolean;
}

export interface PaypalInvoiceLink {
  invoiceId: string;
  url: string;
}

function baseUrl(creds: PaypalCreds): string {
  return creds.sandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

/** Error con el status HTTP en el mensaje (los 4xx no se reintientan río arriba). */
async function fail(step: string, res: Response): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new Error(`PayPal ${step}: HTTP ${res.status} ${body.slice(0, 300)}`);
}

/** Token OAuth de client credentials (dura ~9h; para nuestro volumen, pedirlo por uso). */
async function getAccessToken(creds: PaypalCreds): Promise<string> {
  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetch(`${baseUrl(creds)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) await fail("oauth", res);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("PayPal oauth: respuesta sin access_token");
  return json.access_token;
}

/**
 * Crea el invoice, lo deja UNPAID (sin email) y devuelve el link pagable.
 * `payload` sale de `buildInvoicePayload` (puro). Lanza con mensaje accionable si
 * PayPal rechaza algo (credenciales, moneda, montos).
 */
export async function createInvoiceLink(
  creds: PaypalCreds,
  payload: Record<string, unknown>,
): Promise<PaypalInvoiceLink> {
  const token = await getAccessToken(creds);
  const base = baseUrl(creds);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  // 1) Crear el draft. `Prefer: return=representation` devuelve el invoice con su
  //    id; si PayPal responde el default minimal (solo href), el id se saca de ahí.
  const createRes = await fetch(`${base}/v2/invoicing/invoices`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!createRes.ok) await fail("create-invoice", createRes);
  const created = (await createRes.json()) as { id?: string; href?: string };
  const invoiceId = created.id ?? created.href?.split("/").pop() ?? "";
  if (!invoiceId) throw new Error("PayPal create-invoice: respuesta sin id ni href");

  // 2) Enviarlo SIN email (share link): pasa a UNPAID y el link queda activo.
  const sendRes = await fetch(`${base}/v2/invoicing/invoices/${invoiceId}/send`, {
    method: "POST",
    headers,
    body: JSON.stringify({ send_to_invoicer: false, send_to_recipient: false }),
    cache: "no-store",
  });
  if (!sendRes.ok) await fail("send-invoice", sendRes);

  // 3) Leer el link pagable. Respaldo: el formato público conocido del invoice.
  const getRes = await fetch(`${base}/v2/invoicing/invoices/${invoiceId}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  let url = "";
  if (getRes.ok) {
    const invoice = (await getRes.json()) as {
      detail?: { metadata?: { recipient_view_url?: string } };
    };
    url = invoice.detail?.metadata?.recipient_view_url ?? "";
  }
  if (!url) {
    url = creds.sandbox
      ? `https://www.sandbox.paypal.com/invoice/p/#${invoiceId}`
      : `https://www.paypal.com/invoice/p/#${invoiceId}`;
  }

  return { invoiceId, url };
}
