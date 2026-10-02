/**
 * Служебный маршрут: показывает, что приложение живо и какой релей настроен.
 * Никаких данных о комнатах он не знает — серверу они не нужны.
 */
export const dynamic = 'force-static';

export async function GET() {
  return Response.json({
    ok: true,
    service: 'bridge',
    relay: process.env.NEXT_PUBLIC_RELAY_URL || 'https://ntfy.sh',
    wsRelay: process.env.NEXT_PUBLIC_WS_RELAY ? 'свой' : 'публичный',
    version: 1,
    time: new Date().toISOString(),
  });
}
