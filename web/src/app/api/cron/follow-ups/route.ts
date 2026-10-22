import { timingSafeEqual } from "node:crypto";

/**
 * Disparo diário da automação de follow-up pelo Cron da Vercel.
 *
 * A API no plano gratuito do Render hiberna quando fica sem tráfego, e aí o
 * agendamento interno dela não roda. A Vercel chama esta rota no horário
 * (vercel.json); a rota acorda a API e dispara a automação, que é
 * idempotente: se o agendamento interno já tiver rodado, nada é duplicado.
 */
export const maxDuration = 60;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const isAuthorized = (header: string | null): boolean => {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
};

export async function GET(request: Request) {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const response = await fetch(`${API_URL}/automations/follow-ups/cron`, {
    method: "POST",
    headers: { "x-automation-secret": process.env.AUTOMATION_SECRET ?? "" },
    signal: AbortSignal.timeout(55_000),
  });
  const body: unknown = await response.json().catch(() => null);
  return Response.json({ status: response.status, run: body }, { status: response.ok ? 200 : 502 });
}
