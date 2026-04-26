// Cloudflare Pages Function: POST /api/submit-partial
// Accepts JSON {nimi, telefon, epost, aadress, lang} for the step-1 lead-capture push.
// Generates a leadId, fires the Google Sheet webhook (best-effort), returns { ok, leadId }.

// TODO: After deploying the Apps Script web app, paste the deployment URL between the quotes below.
// Until set, the Sheets push is skipped — emails / form still work normally.
const SHEETS_WEBHOOK_URL = '';

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405, { Allow: 'POST' });
  }

  let body;
  try { body = await request.json(); }
  catch (_) { return json({ ok: false, error: 'Invalid JSON' }, 400); }

  const nimi = (body.nimi || '').toString().trim();
  const telefon = (body.telefon || '').toString().trim();
  const epost = (body.epost || '').toString().trim();
  const aadress = (body.aadress || '').toString().trim();
  const lang = (body.lang || '').toString().toLowerCase() === 'ru' ? 'ru' : 'et';

  if (!nimi || !telefon || !epost || !aadress) {
    return json({ ok: false, error: 'Missing required fields' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(epost)) {
    return json({ ok: false, error: 'Invalid email' }, 400);
  }

  const leadId = generateLeadId();
  const timestamp = new Date().toISOString();

  // Push to Sheets webhook — best-effort, never blocks the response.
  if (SHEETS_WEBHOOK_URL) {
    try {
      const res = await fetch(SHEETS_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'partial',
          leadId, lang, nimi, telefon, epost, aadress, timestamp,
        }),
      });
      if (!res.ok) {
        console.error('Sheets partial webhook non-OK', res.status);
      }
    } catch (e) {
      console.error('Sheets partial webhook threw', String(e).slice(0, 200));
    }
  }

  return json({ ok: true, leadId }, 200);
}

function generateLeadId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC4122-ish fallback
  return 'lead-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function json(obj, status, extraHeaders) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  return new Response(JSON.stringify(obj), { status, headers });
}
