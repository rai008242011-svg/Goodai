// Vercel サーバー関数: /api/stt （Groq Whisperで音声を文字にする）
// 環境変数: GROQ_API_KEY (必須) / APP_PASSCODE (任意) / GROQ_STT_MODEL (任意)

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POSTだけ使えます' }); return; }
  const pass = process.env.APP_PASSCODE;
  if (pass && req.headers['x-pass'] !== pass) { res.status(401).json({ error: '合言葉が違います' }); return; }
  const key = process.env.GROQ_API_KEY;
  if (!key) { res.status(500).json({ error: 'GROQ_API_KEY が未設定です' }); return; }

  let buf = req.body;
  if (!Buffer.isBuffer(buf)) {
    const c = [];
    for await (const x of req) c.push(x);
    buf = Buffer.concat(c);
  }
  if (!buf.length || buf.length > 4000000) { res.status(400).json({ error: '音声が空か、大きすぎます' }); return; }

  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'a.wav');
  fd.append('model', process.env.GROQ_STT_MODEL || 'whisper-large-v3');
  fd.append('language', 'ja');
  fd.append('temperature', '0');
  try {
    const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { authorization: 'Bearer ' + key }, body: fd
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { res.status(502).json({ error: (j.error && j.error.message) || ('文字起こしエラー ' + r.status) }); return; }
    res.status(200).json({ text: String(j.text || '').trim() });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
