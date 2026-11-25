// Вивантажує результати JS-двигуна для звірки з незалежною реалізацією (server/test/crosscheck.py).
import { yearMatrix, monthlyEnergies, validateInput } from '../engine.js';

const today = new Date(2026, 10, 26);
const out = [];
for (let y = 1940; y <= 2026; y++) {
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= 31; d++) {
      for (const year of [2026, 2027, 2028]) {
        if (validateInput({ d, m, y }, year, today)) continue;
        const mx = yearMatrix({ d, m, y }, year);
        const months = monthlyEnergies(mx).map((x) => [x.group, x.main, x.opposite]);
        out.push([d, m, y, year, mx, months]);
      }
    }
  }
}
process.stdout.write(JSON.stringify(out));
