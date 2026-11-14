// Vercel serverless function: reads a parcel label photo with Claude vision.
// Env vars (Vercel > Settings > Environment Variables):
//   ANTHROPIC_API_KEY  (required)
//   APP_PASSWORD       (optional, recommended: the app asks for it once)
//   ANTHROPIC_MODEL    (optional, default claude-sonnet-5-5)
const PROMPT = `Hadi tswira dyal étiquette dyal colis (Olivraison, Maroc). Extract these 4 fields and answer with JSON ONLY, no other text:
{"num":"","tel":"","prix":"","ville":""}
- num: tracking number printed after "#", starts with SAL (example SAL6964188DEF3A011262). Copy it exactly, same letters and digits. If a QR/barcode is the only source, leave empty.
- tel: phone number of the DESTINATAIRE only (the "Tél:" line inside the Destinataire block). NOT the Expéditeur phone, NOT +212.520.015.583. Format: 10 digits starting with 0.
- prix: the amount to collect in the dark CRBT box, number only in DH (example 1280). If it says 0.00 DH put 0.
- ville: the city written in the small framed box next to the Date, left of the HUB box (example SALE). Not the Expéditeur city.
Use "" for anything you cannot read with confidence. Never guess digits.`;

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
    const tel = String(o.tel || '').replace(/\D/g, '').replace(/^212/, '0');
    const num = String(o.num || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const prix = String(o.prix == null ? '' : o.prix).replace(/[^\d.,]/g, '').replace(',', '.').replace(/\.0+$/, '');
    return res.status(200).json({ num: /^SA[LD][A-Z0-9]{8,}$/.test(num) ? num : '', tel: /^0[5-7]\d{8}$/.test(tel) ? tel : '', prix, ville: String(o.ville || '').trim() });
  } catch (e) {
    return res.status(502).json({ error: 'failed' });
  }
};
