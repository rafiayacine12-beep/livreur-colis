// Vercel serverless function: reads a parcel label photo with Claude vision.
// Env vars (Vercel > Settings > Environment Variables):
//   ANTHROPIC_API_KEY  (required)
//   APP_PASSWORD       (optional, recommended: the app asks for it once)
//   ANTHROPIC_MODEL    (optional, default claude-sonnet-5-5)
const PROMPT = `Hadi tswira dyal étiquette dyal colis (Olivraison, Maroc). Copy these 4 fields EXACTLY as they are printed on the label, character by character: same digits, same letters, same capitals, same decimals. Do not fix, reformat, round, translate or normalise anything. Answer with JSON ONLY, no other text:
{"num":"","tel":"","prix":"","ville":"","doubt":[]}
- num: tracking number printed after "#", starts with SAL (example SAL6964188DEF3A011262). Copy it exactly (without the # sign), same letters and digits. If a QR/barcode is the only source, leave empty.
- tel: phone number of the DESTINATAIRE only (the "Tél:" line inside the Destinataire block). NOT the Expéditeur phone, NOT +212.520.015.583. Copy the digits exactly as printed.
- prix: the amount to collect in the dark CRBT box, copy the number exactly as printed, without the DH unit (example 1280.00; if it prints 0.00 DH put 0.00).
- ville: the city written in the small framed box next to the Date, left of the HUB box exactly as printed (example SALE). Not the Expéditeur city.
Read each field twice before answering. Use "" for anything you cannot read with confidence. Never guess digits. In "doubt" list the field names (num, tel, prix, ville) that are blurry, partly hidden by tape, pen marks or glare, or that you are not fully sure about.`;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const pass = process.env.APP_PASSWORD;
  if (pass && req.headers['x-app-pass'] !== pass) return res.status(401).json({ error: 'password' });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'no_api_key' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const m = String((body && body.image) || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: 'bad_image' });
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
        max_tokens: 300,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
          { type: 'text', text: PROMPT }
        ] }]
      })
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: 'anthropic', status: r.status, detail: (j && j.error && j.error.message) || '' });
    const text = ((j.content || []).find(c => c.type === 'text') || {}).text || '';
    const mm = text.match(/\{[\s\S]*\}/);
    if (!mm) return res.status(502).json({ error: 'no_json' });
    const o = JSON.parse(mm[0]);
    const tel = String(o.tel || '').trim();
    const num = String(o.num || '').replace(/[#\s]/g, '');
    const prix = String(o.prix == null ? '' : o.prix).replace(/dh|mad|\s/gi, '');
    const doubt = Array.isArray(o.doubt) ? o.doubt.filter(x => ['num','tel','prix','ville'].includes(x)) : [];
    if (tel && !/^0[5-7]\d{8}$/.test(tel.replace(/\D/g, ''))) doubt.push('tel');
    if (num && !/^SA[LD][A-Z0-9]{8,}$/i.test(num)) doubt.push('num');
    return res.status(200).json({ num, tel, prix, ville: String(o.ville || '').trim(), doubt: [...new Set(doubt)] });
  } catch (e) {
    return res.status(502).json({ error: 'failed' });
  }
};
