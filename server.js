const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ROOT = __dirname;
const HTML = path.join(ROOT, 'strona_LOOKSMAXER_GOTOWA.html');

const SYSTEM_PROMPT = `Jesteś AI Looksmaxer — specjalistycznym asystentem dotyczącym looksmaxingu, pielęgnacji, stylu, włosów, skóry, sylwetki, proporcji twarzy i innych tematów powiązanych.

ZASADY:
1. Korzystaj z informacji przekazanych w KNOWLEDGE FROM THIS WEBSITE jako wiedzy strony. Nie udawaj, że każda teza z tej strony jest naukowo potwierdzona.
2. Wyraźnie oddzielaj: informacje ze strony, informacje ogólne oraz ustalenia naukowe.
3. Nie wymyślaj faktów ani źródeł. Jeśli czegoś nie wiesz, powiedz to.
4. Nie podawaj instrukcji DIY dotyczących operacji, zastrzyków, samodzielnego pobierania/wstrzykiwania krwi, bonesmashingu, nielegalnych/niebezpiecznych leków, hormonów, sterydów, insuliny itp.
5. Przy pytaniach medycznych nie diagnozuj i nie przedstawiaj ryzykownej metody jako pewnego sposobu poprawy wyglądu.
6. Odpowiadaj po polsku, konkretnie i bez zbędnego lania wody.. Możesz używać terminologii looksmaxing, ale w razie potrzeby wyjaśnij ją normalnym językiem.
7. Nie oceniaj człowieka jako „subhuman", „cuck", „god-tier" itp. Możesz wyjaśniać takie określenia, ale nie używaj ich do poniżania użytkownika.
8. Jeśli użytkownik pyta o zawartość tej strony, traktuj KNOWLEDGE FROM THIS WEBSITE jako główne źródło treści strony.
`;

function send(res, status, body, type='application/json') { 
  res.writeHead(status, {
    'Content-Type': `${type}; charset=utf-8`, 
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  }); 
  res.end(type === 'application/json' ? JSON.stringify(body) : body); 
}

function readBody(req) { 
  return new Promise((resolve, reject) => { 
    let b = ''; 
    req.on('data', c => { b += c; if (b.length > 2e6) req.destroy(); }); 
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch(e) { reject(e); } }); 
    req.on('error', reject); 
  }); 
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    return res.end();
  }

  if (req.method === 'GET' && req.url.startsWith('/api/site-knowledge')) {
    return send(res, 200, { knowledge: SYSTEM_PROMPT });
  }

  if (req.method === 'POST' && req.url.startsWith('/api/chat')) {
    if (!GEMINI_API_KEY) return send(res, 500, { error: 'Brak GEMINI_API_KEY w zmiennych środowiskowych.' });
    
    try {
      const body = await readBody(req);
      const message = String(body.message || '').slice(0, 12000);
      const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
      const siteKnowledge = String(body.siteKnowledge || '').slice(0, 70000);
      
      const prompt = `${SYSTEM_PROMPT}\n\nKNOWLEDGE FROM THIS WEBSITE:\n${siteKnowledge}\n\nUSER CONVERSATION:\n${history.map(x => `${x.role}: ${x.content}`).join('\n')}\n\nCURRENT USER QUESTION: ${message}`;
      
      // Zmieniono model na gemini-1.5-flash, który jest w pełni wspierany
      const apiRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + encodeURIComponent(GEMINI_API_KEY), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }]
        })
      });

      const data = await apiRes.json();
      if (!apiRes.ok) return send(res, apiRes.status, { error: data?.error?.message || 'Gemini API error' });
      
      const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || 'Brak odpowiedzi.';
      send(res, 200, { text });
    } catch(e) { 
      send(res, 500, { error: e.message || 'Błąd serwera' }); 
    }
    return;
  }

  if (req.method === 'GET') {
    let file = req.url === '/' ? HTML : path.join(ROOT, req.url.split('?')[0]);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) return send(res, 404, { error: 'Not found' });
    const ext = path.extname(file); 
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    return send(res, 200, fs.readFileSync(file), types[ext] || 'text/plain');
  }

  send(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, () => console.log(`AI Looksmaxer running at http://localhost:${PORT}`));
