// Браузерна частина статичної версії (GitHub Pages): той самий двигун і збірка, що й на сервері.
// Тексти зберігаються зашифрованими (AES-GCM, ключ із пароля через PBKDF2) і розшифровуються лише в браузері.
import { buildForecast } from './forecast.js';
import { validateInput } from './engine.js';

const PASS_KEY = 'prog_pass';
let content = null;

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function decrypt(pass) {
  const enc = await fetch('content.enc.json', { cache: 'no-cache' }).then((r) => r.json());
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(enc.salt), iterations: enc.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

window.progUnlock = async (pass) => {
  try {
    content = await decrypt(pass);
    window.progUnlocked = true;
    try { localStorage.setItem(PASS_KEY, pass); } catch { /* приватний режим */ }
    return true;
  } catch {
    return false;
  }
};

window.progForecast = async ({ birth, year, status, children }) => {
  if (!content) throw new Error('Потрібен пароль');
  const err = validateInput(birth, year);
  if (err) throw new Error(err);
  const hasChildren = children === true ? true : children === false ? false : null;
  return buildForecast(content, {
    birth, year, plan: 'full', status: status || 'unknown', hasChildren, periodMode: 'birthday_after_15',
  });
};

// Вхід без пароля: ключ у посиланні (?k=...). Інакше — пароль, уже введений на цьому пристрої.
window.progReady = (async () => {
  const url = new URL(location.href);
  const k = url.searchParams.get('k');
  if (k) {
    url.searchParams.delete('k');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
    if (await window.progUnlock(k)) return;
  }
  let saved = null;
  try { saved = localStorage.getItem(PASS_KEY); } catch { /* немає доступу */ }
  if (saved && !(await window.progUnlock(saved))) {
    try { localStorage.removeItem(PASS_KEY); } catch { /* немає доступу */ }
  }
})();
