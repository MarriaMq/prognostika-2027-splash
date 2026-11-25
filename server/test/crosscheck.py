"""Незалежна перевірка формул: друга реалізація, написана прямо з тексту ТЗ №16 v1.1,
без звернення до JS-коду. Порівнює кожну точку матриці та всі 12 місяців.

Запуск: node test/dump.mjs > /tmp/x.json && python3 -I test/crosscheck.py /tmp/x.json
"""
import json
import sys


def red(n):
    # «якщо число від 1 до 22 — залишаю; якщо більше 22 — додаю цифри й повторюю»
    while n > 22:
        n = sum(int(c) for c in str(n))
    return n


def calc(d, m, y, year):
    dd, mm, yy = red(d), red(m), red(sum(int(c) for c in str(y)))
    t = red(sum(int(c) for c in str(year)))
    p = {}
    p["t"] = t
    p["CODE"] = red(dd + mm + yy + t)
    p["A"] = red(dd + t)
    p["B"] = red(mm + t)
    p["V"] = red(yy + t)
    p["G"] = red(p["A"] + p["B"] + p["V"])
    p["C"] = red(p["A"] + p["B"] + p["V"] + p["G"])
    p["D"] = red(p["A"] + p["B"])
    p["E"] = red(p["B"] + p["V"])
    p["Zh"] = red(p["V"] + p["G"])
    p["Z"] = red(p["A"] + p["G"])
    p["M"] = red(p["C"] + p["G"])
    p["L"] = red(p["C"] + p["V"])
    p["K"] = red(p["M"] + p["L"])
    p["N"] = red(p["M"] + p["K"])
    p["O"] = red(p["K"] + p["L"])
    p["MG"] = red(p["M"] + p["G"])
    p["V2"] = red(p["V"] + p["L"])
    p["B1"] = red(p["B"] + p["C"])
    p["B2"] = red(p["B"] + p["B1"])
    p["DBS2"] = red(p["A"] + p["C"])
    p["DBS3"] = red(p["A"] + p["DBS2"])
    p["SKY"] = red(p["B"] + p["G"])
    p["EARTH"] = red(p["A"] + p["V"])
    p["MALE"] = red(p["D"] + p["Zh"])
    p["FEMALE"] = red(p["E"] + p["Z"])
    p["PURPOSE"] = red(p["SKY"] + p["EARTH"] + p["MALE"] + p["FEMALE"])

    def seven(x, y_):
        mid = red(x + y_)                       # 4-та (середина)
        s2 = red(x + mid); s6 = red(mid + y_)   # 2-га, 6-та
        s1 = red(x + s2); s3 = red(s2 + mid)    # 1-ша, 3-тя
        s5 = red(mid + s6); s7 = red(s6 + y_)   # 5-та, 7-ма
        return [s1, s2, s3, mid, s5, s6, s7]

    ring = []
    for a, corner, b in (("A", "D", "B"), ("B", "E", "V"), ("V", "Zh", "G"), ("G", "Z", "A")):
        fifteen = seven(p[a], p[corner]) + [p[corner]] + seven(p[corner], p[b])
        ring += [fifteen[0:5], fifteen[5:10], fifteen[10:15]]
    months = [[g, g[2], ring[(i + 6) % 12][2]] for i, g in enumerate(ring)]
    return p, months


def main():
    rows = json.load(open(sys.argv[1]))
    bad = 0
    for d, m, y, year, mx, months in rows:
        p, mo = calc(d, m, y, year)
        for k, v in p.items():
            if mx[k] != v:
                bad += 1
                if bad < 10:
                    print("РОЗБІЖНІСТЬ", d, m, y, year, k, mx[k], v)
        if mo != months:
            bad += 1
            if bad < 10:
                print("РОЗБІЖНІСТЬ місяці", d, m, y, year)
    print(f"перевірено комбінацій: {len(rows)}; точок і місяців у кожній: {len(p)} + 12; розбіжностей: {bad}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
