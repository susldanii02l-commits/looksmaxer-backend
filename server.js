const http = require('http');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ROOT = __dirname;
const HTML = path.join(ROOT, 'strona_LOOKSMAXER_GOTOWA.html');

// Połączenie z bazą PostgreSQL z Railway
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const SYSTEM_PROMPT = `Jesteś AI Looksmaxer — specjalistycznym asystentem dotyczącym looksmaxingu, pielęgnacji, stylu, włosów, skóry, sylwetki, proporcji twarzy i innych tematów powiązanych.

ZASADY:
1. Korzystaj z informacji przekazanych w KNOWLEDGE FROM THIS WEBSITE jako wiedzy strony. Nie udawaj, że każda teza z tej strony jest naukowo potwierdzona.
2. Wyraźnie oddzielaj: informacje ze strony, informacje ogólne oraz ustalenia naukowe.
3. Nie wymyślaj faktów ani źródeł. Jeśli czegoś nie wiesz, powiedz to.
4. Nie podawaj instrukcji DIY dotyczących operacji, zastrzyków, samodzielnego pobierania/wstrzykiwania krwi, bonesmashingu, nielegalnych/niebezpiecznych leków, hormonów, sterydów, insuliny itp.
5. Przy pytaniach medycznych nie diagnozuj i nie przedstawiaj ryzykownej metody jako pewnego sposobu poprawy wyglądu.
6. Odpowiadaj po polsku, konkretnie i bez zbędnego lania wody. Możesz używać terminologii looksmaxing, ale w razie potrzeby wyjaśnij ją normalnym językiem.
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

  // === REJESTRACJA UŻYTKOWNIKA ===
  if (req.method === 'POST' && req.url.startsWith('/api/register')) {
    try {
      const body = await readBody(req);
      const { email, password } = body;
      if (!email || !password) return send(res, 400, { error: 'Podaj email i hasło' });

      const hashedPassword = await bcrypt.hash(password, 10);
      const result = await pool.query(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email, hashedPassword]
      );
      return send(res, 200, { message: 'Zarejestrowano pomyślnie!', user: result.rows[0] });
    } catch (err) {
      return send(res, 400, { error: 'Błąd rejestracji (ten email może być już zajęty)' });
    }
  }

  // === LOGOWANIE UŻYTKOWNIKA ===
  if (req.method === 'POST' && req.url.startsWith('/api/login')) {
    try {
      const body = await readBody(req);
      const { email, password } = body;
      if (!email || !password) return send(res, 400, { error: 'Podaj email i hasło' });

      const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (userResult.rows.length === 0) return send(res, 400, { error: 'Błędny email lub hasło' });

      const user = userResult.rows[0];
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) return send(res, 400, { error: 'Błędny email lub hasło' });

      return send(res, 200, { message: 'Zalogowano pomyślnie!', userId: user.id, email: user.email });
    } catch (err) {
      return send(res, 500, { error: 'Błąd serwera podczas logowania' });
    }
  }

  // === ISTNIEJĄCE ENDPOINTY AI I STRONY ===
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
      
      const contents = history.map(x => ({
        role: x.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: x.content }]
      }));
      
      const userFullPrompt = `KNOWLEDGE FROM THIS WEBSITE:\n${siteKnowledge}\n\nCURRENT USER QUESTION: ${message}`;
      contents.push({ role: 'user', parts: [{ text: userFullPrompt }] });

      const apiRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=' + encodeURIComponent(GEMINI_API_KEY), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: contents
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
