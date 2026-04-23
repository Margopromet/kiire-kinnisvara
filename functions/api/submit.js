// Cloudflare Pages Function: POST /api/submit
// Relays the lead form (multipart/form-data) to Resend as an HTML email with attachments.
// Env var required: RESEND_API_KEY

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
  try {
    form = await request.formData();
  } catch (e) {
    return json({ ok: false, error: 'Vormi parsimine ebaõnnestus' }, 400);
  }

  // Honeypot: silently succeed if a bot filled it.
  const botcheck = (form.get('botcheck') || '').toString().trim();
  if (botcheck) {
    return json({ ok: true }, 200);
  }

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
  // Form uses `tyyp` (select) and `objekt_tyyp` as a legacy fallback.
  const objektTyyp = get('tyyp') || get('objekt_tyyp');
  const kuulutusLink = get('kuulutus_link');
  const korrus = get('korrus');
  const viimaneKorrus = get('viimane_korrus');
  const turuhinnastMadalam = get('turuhinnast_madalam');
  const noustumine = get('noustumine');
  const kommentaar = get('kommentaar');
  const seisukord = get('seisukord');
  const asukohtMajas = get('asukoht_majas');

  // Required fields
  if (!nimi || !telefon || !noustumine || !turuhinnastMadalam) {
    return json({
      ok: false,
      error: 'Palun täida nõutud väljad: nimi, telefon, nõusolek andmete töötlemiseks ning nõusolek turuhinnast madalama hinnaga müügiks.',
    }, 400);
  }

  // Collect attachments under the "failid" field (HTML uses this name).
  const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 20 MB cap
  const attachments = [];
  let totalBytes = 0;
  const rawFiles = form.getAll('failid');
  for (const f of rawFiles) {
    if (!(f && typeof f === 'object' && 'arrayBuffer' in f)) continue;
    const size = typeof f.size === 'number' ? f.size : 0;
    if (size === 0) continue;
    if (totalBytes + size > MAX_TOTAL_BYTES) {
      // Skip gracefully when over the cap.
      continue;
    }
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      totalBytes += buf.byteLength;
      attachments.push({
        filename: f.name || 'fail',
        content: toBase64(buf),
      });
    } catch (_) {
      // ignore unreadable attachment
    }
  }

  const html = buildHtml({
    nimi, telefon, email, aadress, objektTyyp,
    kuulutusLink, korrus, viimaneKorrus, turuhinnastMadalam,
    kommentaar, noustumine,
    aadressFull, adrid, ehak, zip, street, house, apartment,
    seisukord,
    asukohtMajas,
    attachmentsCount: attachments.length,
  });

  const body = {
    from: 'Kinnisvara Kiire Ost <info@kiireost.ee>',
    to: ['margarita.prometnaja@gmail.com'],
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
  const seisukordMap = { vajab_kapitaalremonti: 'Vajab kapitaalremonti', vajab_varskendust: 'Vajab värskendust', renoveeritud: 'Renoveeritud', uusarendus: 'Uusarendus' };
  const asukohtMap = { otsakorter: 'Otsakorter', keskmine: 'Maja keskel' };
  return `<!doctype html>
<html><body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#111827">
  <h2 style="margin:0 0 12px">Uus päring kodulehelt</h2>
  <p style="margin:0 0 12px;color:#6b7280">kiire-kinnisvara.pages.dev</p>
  <table style="border-collapse:collapse;border:1px solid #e5e7eb;min-width:480px">
    ${row('Nimi', d.nimi)}
    ${row('Telefon', d.telefon)}
    ${row('E-post', d.email)}
    ${row('Aadress', d.aadress)}
        ${row('Aadress (täistekst In-ADS)', d.aadressFull)}
        ${row('ADRID', d.adrid)}
        ${row('EHAK', d.ehak)}
        ${row('Sihtnumber', d.zip)}
        ${row('Tänav', d.street)}
        ${row('Majanumber', d.house)}
        ${row('Korteri nr', d.apartment)}
    ${row('Objekti tüüp', d.objektTyyp)}
    ${row('Kuulutuse link', d.kuulutusLink)}
    ${korterOnly ? row('Korrus', d.korrus) : ''}
    ${korterOnly ? row('Viimane korrus', d.viimaneKorrus === 'on' || d.viimaneKorrus === 'true' ? 'Jah' : '') : ''}
    ${korterOnly ? row('Korteri seisukord', seisukordMap[d.seisukord] || '') : ''}
    ${korterOnly ? row('Korteri asukoht majas', asukohtMap[d.asukohtMajas] || '') : ''}
    ${row('Nõus turuhinnast madalama hinnaga', d.turuhinnastMadalam ? 'Jah' : '')}
    ${row('Kommentaar', d.kommentaar)}
    ${row('Nõusolek andmete töötlemiseks', d.noustumine ? 'Jah' : '')}
    ${row('Manuste arv', String(d.attachmentsCount))}
  </table>
</body></html>`;
}

function toBase64(u8) {
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
  }
  return btoa(s);
}
