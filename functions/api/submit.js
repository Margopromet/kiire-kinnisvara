// Cloudflare Pages Function: POST /api/submit
// Relays the lead form (multipart/form-data) to Resend as an HTML email with attachments.
// Also pushes a row to the Google Sheets webhook (best-effort) and links a partial leadId if present.
// Env var required: RESEND_API_KEY

// TODO: After deploying the Apps Script web app, paste the deployment URL between the quotes below.
// Until set, the Sheets push is skipped — emails still send normally.
const SHEETS_WEBHOOK_URL = '';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Allow': 'POST' },
    });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return json({ ok: false, error: 'Oodatud on multipart/form-data' }, 400);
  }

  let form;
  try { form = await request.formData(); }
  catch (e) { return json({ ok: false, error: 'Vormi parsimine ebaõnnestus' }, 400); }

  // Honeypot
  const botcheck = (form.get('botcheck') || '').toString().trim();
  if (botcheck) return json({ ok: true }, 200);

  const get = (k) => (form.get(k) || '').toString().trim();
  const nimi = get('nimi');
  const telefon = get('telefon');
  const email = get('email');
  const aadress = get('aadress');
  const aadressFull = get('aadress_full');
  const adrid = get('adrid');
  const ehak = get('ehak');
  const zip = get('zip');
  const street = get('street');
  const house = get('house');
  const apartment = get('apartment');
  const objektTyyp = get('tyyp') || get('objekt_tyyp');
  const ruume = get('ruume');
  const pindala = get('pindala');
  const korrus = get('korrus');
  const viimaneKorrus = get('viimane_korrus');
  const turuhinnastMadalam = get('turuhinnast_madalam');
  const noustumine = get('noustumine');
  const lisainfo = get('lisainfo');
  const seisukord = get('seisukord');
  const asukohtMajas = get('asukoht_majas');
  const soovhind = get('soovhind');
  const leadId = get('leadId');

  const langRaw = (form.get('lang') || '').toString().trim().toLowerCase();
  const lang = langRaw === 'ru' ? 'ru' : 'et';

  if (!nimi || !telefon || !noustumine || !turuhinnastMadalam) {
    return json({
      ok: false,
      error: 'Palun täida nõutud väljad: nimi, telefon, nõusolek andmete töötlemiseks ning nõusolek turuhinnast madalama hinnaga müügiks.',
    }, 400);
  }

  // Attachments
  const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
  const attachments = [];
  let totalBytes = 0;
  const rawFiles = form.getAll('failid');
  for (const f of rawFiles) {
    if (!(f && typeof f === 'object' && 'arrayBuffer' in f)) continue;
    const size = typeof f.size === 'number' ? f.size : 0;
    if (size === 0) continue;
    if (totalBytes + size > MAX_TOTAL_BYTES) continue;
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      totalBytes += buf.byteLength;
      attachments.push({ filename: f.name || 'fail', content: toBase64(buf) });
    } catch (_) {}
  }

  const html = buildHtml({
    nimi, telefon, email, aadress, objektTyyp, ruume, pindala,
    korrus, viimaneKorrus, turuhinnastMadalam, lisainfo, noustumine,
    soovhind, aadressFull, adrid, ehak, zip, street, house, apartment,
    seisukord, asukohtMajas, leadId,
    attachmentsCount: attachments.length,
  });

  const body = {
    from: 'Kinnisvara Kiire Ost <info@kiireost.ee>',
    to: ['info@kiireost.ee'],
    subject: `Uus päring: ${nimi}${aadress ? ' — ' + aadress : ''}`,
    html,
  };
  if (email) body.reply_to = email;
  if (attachments.length) body.attachments = attachments;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('Resend error', res.status, text.slice(0, 200));
      return json({ ok: false, error: 'Saatmine ebaõnnestus. Proovi hiljem uuesti.' }, 500);
    }

    // Client confirmation email (best-effort, doesn't block the response).
    if (email) {
      try {
        const clientHtmlEt = `<p>Tere${nimi ? ', ' + nimi : ''}!</p><p>Täname teid päringu eest. Saime selle kätte ja võtame teiega ühendust 1 tööpäeva jooksul, et leppida kokku objekti ülevaatuse aeg. Ülevaatuse järel esitame teile kirjaliku ja mittesiduva pakkumise.</p><p>Kui teil on vahepeal küsimusi või täiendusi, kirjutage julgesti aadressile <a href="mailto:info@kiireost.ee">info@kiireost.ee</a>.</p><p>Parimate soovidega,<br>Kinnisvara Kiire Ost<br><a href="mailto:info@kiireost.ee">info@kiireost.ee</a><br><a href="https://kiireost.ee">kiireost.ee</a></p>`;
        const clientHtmlRu = `<p>Здравствуйте${nimi ? ', ' + nimi : ''}!</p><p>Спасибо за вашу заявку. Мы её получили и свяжемся с вами в течение 1 рабочего дня, чтобы согласовать время осмотра объекта. После осмотра пришлём вам письменное и необязывающее предложение.</p><p>Если у вас за это время появятся вопросы или дополнения — пишите нам на <a href="mailto:info@kiireost.ee">info@kiireost.ee</a>.</p><p>С уважением,<br>Kiireost (Kinnisvara Kiire Ost)<br><a href="mailto:info@kiireost.ee">info@kiireost.ee</a><br><a href="https://kiireost.ee/ru/">kiireost.ee/ru</a></p>`;
        const clientHtml = lang === 'ru' ? clientHtmlRu : clientHtmlEt;
        const clientSubject = lang === 'ru' ? 'Спасибо за заявку! — Kiireost' : 'Aitäh päringu eest! — Kinnisvara Kiire Ost';
        const clientFrom = lang === 'ru' ? 'Kiireost <info@kiireost.ee>' : 'Kinnisvara Kiire Ost <info@kiireost.ee>';

        const clientRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: clientFrom, to: [email], subject: clientSubject,
            html: clientHtml, reply_to: 'info@kiireost.ee',
          }),
        });
        if (!clientRes.ok) {
          const ctxt = await clientRes.text().catch(() => '');
          console.error('Client confirmation email failed', clientRes.status, ctxt.slice(0, 200));
        }
      } catch (ce) {
        console.error('Client confirmation email threw', String(ce).slice(0, 200));
      }
    }

    // Push to Sheets webhook — best-effort, never blocks the response.
    if (SHEETS_WEBHOOK_URL) {
      try {
        const sheetsRes = await fetch(SHEETS_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'full', leadId, lang,
            nimi, telefon, epost: email, aadress,
            'tüüp': objektTyyp, tyyp: objektTyyp,
            ruume, pindala, korrus, seisukord, soovhind,
            turuhinnastMadalam: turuhinnastMadalam ? 'jah' : '',
            lisainfo, source: '',
            timestamp: new Date().toISOString(),
          }),
        });
        if (!sheetsRes.ok) console.error('Sheets full webhook non-OK', sheetsRes.status);
      } catch (e) {
        console.error('Sheets full webhook threw', String(e).slice(0, 200));
      }
    }

    return json({ ok: true }, 200);
  } catch (e) {
    console.error('submit.js fetch error', String(e).slice(0, 200));
    return json({ ok: false, error: 'Serveri viga. Proovi hiljem uuesti.' }, 500);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function row(label, value) {
  if (!value) return '';
  return `<tr><td style="padding:6px 10px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;width:200px">${esc(label)}</td><td style="padding:6px 10px;border:1px solid #e5e7eb">${esc(value)}</td></tr>`;
}

function buildHtml(d) {
  const korterOnly = d.objektTyyp === 'korter';
  const seisukordMap = {
    vajab_kapitaalremonti: 'Vajab kapitaalremonti',
    vajab_varskendust: 'Vajab värskendust',
    renoveeritud: 'Renoveeritud',
    uusarendus: 'Uusarendus',
  };
  const asukohtMap = { otsakorter: 'Otsakorter', keskmine: 'Maja keskel' };
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#111827"><h2 style="margin:0 0 12px">Uus päring kodulehelt</h2><p style="margin:0 0 12px;color:#6b7280">kiireost.ee</p><table style="border-collapse:collapse;border:1px solid #e5e7eb;min-width:480px">${row('Nimi', d.nimi)}${row('Telefon', d.telefon)}${row('E-post', d.email)}${row('Aadress', d.aadress)}${row('Aadress (täistekst In-ADS)', d.aadressFull)}${row('ADRID', d.adrid)}${row('EHAK', d.ehak)}${row('Sihtnumber', d.zip)}${row('Tänav', d.street)}${row('Majanumber', d.house)}${row('Korteri nr', d.apartment)}${row('Objekti tüüp', d.objektTyyp)}${row('Tubade arv', d.ruume)}${row('Pindala (m²)', d.pindala)}${korterOnly ? row('Korrus', d.korrus) : ''}${korterOnly ? row('Viimane korrus', d.viimaneKorrus === 'on' || d.viimaneKorrus === 'jah' || d.viimaneKorrus === 'true' ? 'Jah' : '') : ''}${korterOnly ? row('Korteri seisukord', seisukordMap[d.seisukord] || '') : ''}${korterOnly ? row('Korteri asukoht majas', asukohtMap[d.asukohtMajas] || '') : ''}${row('Nõus turuhinnast madalama hinnaga', d.turuhinnastMadalam ? 'Jah' : '')}${row('Soovhind (€)', d.soovhind || 'Ei ole märgitud')}${row('Lisainfo', d.lisainfo)}${row('Lead ID (step-1 link)', d.leadId)}${row('Nõusolek andmete töötlemiseks', d.noustumine ? 'Jah' : '')}${row('Manuste arv', String(d.attachmentsCount))}</table></body></html>`;
}

function toBase64(u8) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(s);
}
