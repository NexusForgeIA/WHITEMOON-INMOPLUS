import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// inmo-lead — captura y reparto de leads de la demo WhiteMoon · InmoElite
// (chatbot "CARLOS": triaje comprar / vender / alquilar).
//
// Asigna el lead a un comercial por zona (+ operacion preferente, desempate por
// menor carga, fallback al gerente), lo inserta en leads_inmo y avisa.
//
// Canal de avisos: TELEGRAM (antes CallMeBot/WhatsApp).
//
// Secrets usados (nunca en cliente):
//   - TELEGRAM_BOT_TOKEN        : token del bot de Telegram (obligatorio)
//   - TELEGRAM_CHAT_ID          : chat destino; si falta se usa CHAT_ID_FALLBACK
//   - SUPABASE_URL              : inyectado por la plataforma
//   - SUPABASE_SERVICE_ROLE_KEY : inyectado por la plataforma
//
// Antes se enviaban DOS mensajes: uno al comercial asignado (a su propio
// WhatsApp via su callmebot_apikey) y otro a gerencia. Con Telegram el destino
// es un unico chat, asi que se envia UN solo aviso que ya incluye a quien queda
// asignado el lead. Las columnas comerciales_inmo.wa_number y .callmebot_apikey
// se conservan (crm.html las sigue gestionando via inmo-crm), pero esta funcion
// ya no las lee.
//
// Regla del proyecto: si el aviso falla → console.warn, nunca rompe la captura.
//
// Desplegar con:
//   supabase functions deploy inmo-lead --no-verify-jwt --project-ref mlaqtniujnvfxcvcourm

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// El chat_id no es un secreto (solo identifica el destino); el token si lo es.
const CHAT_ID_FALLBACK = '861432965';

const REST_HEADERS = {
  'Content-Type': 'application/json',
  'apikey': SERVICE_KEY,
  'Authorization': `Bearer ${SERVICE_KEY}`,
};

const OPERACIONES = ['comprar', 'vender', 'alquilar'];

function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// Devuelve true solo si Telegram acepto el mensaje, para poder verificar el
// aviso de punta a punta desde la respuesta de la funcion.
async function notificar(text: string): Promise<boolean> {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID') || CHAT_ID_FALLBACK;
  if (!token) {
    console.warn('[inmo-lead] sin TELEGRAM_BOT_TOKEN, mensaje:', text);
    return false;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!r.ok) {
      console.warn('[inmo-lead] Telegram fallo:', r.status, await r.text());
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[inmo-lead] error enviando Telegram:', e);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: { ...cors, 'Content-Type': 'application/json' } });
  const json = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

  try {
    const body = await req.json();
    const nombre = String(body.nombre || '').slice(0, 120).trim();
    const telefono = String(body.telefono || '').slice(0, 30).trim();
    const operacion = norm(String(body.operacion || ''));
    const zona = String(body.zona || '').slice(0, 60).trim();
    const detalle = String(body.detalle || '').slice(0, 400).trim() || null;

    if (!nombre || telefono.replace(/\D/g, '').length < 9 || !OPERACIONES.includes(operacion) || !zona) {
      return json({ error: 'nombre, telefono (9+ digitos), operacion (comprar|vender|alquilar) y zona obligatorios' }, 400);
    }

    // ---- Asignacion: zona obligatoria + operacion preferente + menor carga + fallback gerente ----
    const cr = await fetch(`${SUPABASE_URL}/rest/v1/comerciales_inmo?activo=eq.true&select=id,nombre,rol,zonas,operaciones`, { headers: REST_HEADERS });
    const equipo = await cr.json();
    const comerciales = (Array.isArray(equipo) ? equipo : []).filter((c: any) => c.rol === 'comercial');
    const gerente = (Array.isArray(equipo) ? equipo : []).find((c: any) => c.rol === 'gerente') || null;

    const zonaN = norm(zona);
    let candidatos = comerciales.filter((c: any) => (c.zonas || []).some((z: string) => norm(z) === zonaN));
    const conOperacion = candidatos.filter((c: any) => (c.operaciones || []).some((o: string) => norm(o) === operacion));
    if (conOperacion.length > 0) candidatos = conOperacion;

    let asignado: any = null;
    if (candidatos.length === 1) asignado = candidatos[0];
    else if (candidatos.length > 1) {
      // desempate por menor carga de leads abiertos
      const cargas: Array<{ c: any; n: number }> = [];
      for (const c of candidatos) {
        const lr = await fetch(`${SUPABASE_URL}/rest/v1/leads_inmo?comercial_id=eq.${c.id}&estado=in.(nuevo,asignado,contactado,visita)&select=id`, { headers: REST_HEADERS });
        const rows = await lr.json();
        cargas.push({ c, n: Array.isArray(rows) ? rows.length : 0 });
      }
      cargas.sort((a, b) => a.n - b.n);
      asignado = cargas[0].c;
    }
    const receptor = asignado || gerente; // fallback

    const ins = await fetch(`${SUPABASE_URL}/rest/v1/leads_inmo`, {
      method: 'POST',
      headers: { ...REST_HEADERS, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        cliente_nombre: nombre, cliente_telefono: telefono, operacion, zona, detalle,
        estado: asignado ? 'asignado' : 'nuevo',
        comercial_id: receptor ? receptor.id : null,
        comercial_asignado: receptor ? receptor.nombre : null,
      }),
    });
    const rows = await ins.json();
    const lead = Array.isArray(rows) ? rows[0] : null;
    if (!lead) return json({ error: 'no se pudo registrar el lead' }, 500);

    await fetch(`${SUPABASE_URL}/rest/v1/inmo_log`, {
      method: 'POST', headers: { ...REST_HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ lead_id: lead.id, accion: 'creado', detalle: `${operacion} · ${zona} · asignado a ${receptor ? receptor.nombre : 'sin asignar'}` }),
    }).catch(() => {});

    const OPER_TXT: Record<string, string> = { comprar: 'COMPRA', vender: 'VENTA (captacion)', alquilar: 'ALQUILER' };
    const msg = `🏠 NUEVO LEAD ${OPER_TXT[operacion]}\n` +
      `Cliente: ${nombre}\n` +
      `Tel: ${telefono}\n` +
      `Zona: ${zona}${detalle ? '\nDetalle: ' + detalle : ''}\n` +
      `Asignado a: ${receptor ? receptor.nombre : 'SIN ASIGNAR'}` +
      (asignado ? '' : '\n⚠️ Sin comercial de zona: asignar manualmente');
    const notified = await notificar(msg);

    return json({ ok: true, lead_id: lead.id, comercial_asignado: receptor ? receptor.nombre : null, notified });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
