"""Print the text of PDF pages (pdftotext, OCR fallback with tesseract 'eng'), with natural-person names scrubbed.
Nothing is written to disk except transient page images in a temp dir that is deleted at once.
Usage: python -I extract.py <pdf> [first_page] [last_page] [--grep REGEX]
"""
import os, re, subprocess, sys, tempfile

TITLES = r"(?:M\.|Mme|MM\.|Mmes|Monsieur|Madame|Mademoiselle|Me|Dr|Docteur|Commissaire|Commandant|Capitaine|Colonel|Général|Lieutenant|Major|Brigadier)"
NAME = r"[A-ZÉÈÀÂÎÔÛÇ][\wéèêëàâîïôûüç'’\-]+"
UP = r"[A-ZÉÈÀÂÎÔÛÇ'’\-]{2,}"

def scrub(t):
    # Title + Firstname/SURNAME sequences
    t = re.sub(TITLES + r"\s+(?:" + NAME + r"[\s\-]*){1,4}", "[PERSONNE]", t)
    # Firstname SURNAME (SURNAME all caps, >=2 letters), e.g. 'Laurent NUÑEZ'
    t = re.sub(r"\b[A-ZÉÈ][a-zéèêëàâîïôûüç]+(?:[\-\s][A-ZÉÈ][a-zéèêëàâîïôûüç]+)?\s+" + UP + r"(?:[\s\-]" + UP + r")?\b", "[PERSONNE]", t)
    # SURNAME Firstname
    t = re.sub(r"\b" + UP + r"\s+[A-ZÉÈ][a-zéèêëàâîïôûüç]{2,}\b(?=\s*(?:,|\n|$|né|née))", "[PERSONNE]", t)
    # 'signé : X' lines
    t = re.sub(r"(?i)(sign[ée]\s*:?)\s*.+", r"\1 [PERSONNE]", t)
    return t

def page_count(pdf):
    out = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout
    m = re.search(r"Pages:\s+(\d+)", out)
    return int(m.group(1)) if m else 0

def page_text(pdf, i):
    t = subprocess.run(["pdftotext", "-layout", "-f", str(i), "-l", str(i), pdf, "-"], capture_output=True, text=True).stdout
    letters = len(re.findall(r"[A-Za-zéè]", t))
    if letters >= 150:
        return t, "text"
    with tempfile.TemporaryDirectory() as d:
        root = os.path.join(d, "p")
        subprocess.run(["pdftoppm", "-r", "250", "-gray", "-png", "-f", str(i), "-l", str(i), pdf, root], capture_output=True)
        imgs = sorted(f for f in os.listdir(d) if f.endswith(".png"))
        if not imgs:
            return t, "empty"
        o = subprocess.run(["tesseract", os.path.join(d, imgs[0]), "stdout", "-l", "eng", "--psm", "6"], capture_output=True, text=True).stdout
    return o, "ocr"

def main():
    a = sys.argv[1:]
    g = None
    if "--grep" in a:
        k = a.index("--grep"); g = re.compile(a[k + 1], re.I); a = a[:k] + a[k + 2:]
    pdf = a[0]
    n = page_count(pdf)
    f = int(a[1]) if len(a) > 1 else 1
    l = int(a[2]) if len(a) > 2 else n
    for i in range(f, min(l, n) + 1):
        t, how = page_text(pdf, i)
        t = scrub(t)
        if g:
            hits = [ln for ln in t.splitlines() if g.search(ln)]
            if hits:
                print(f"--- p{i} ({how})"); print("\n".join(hits))
        else:
            t = re.sub(r"\n\s*\n+", "\n", t)
            print(f"--- p{i}/{n} ({how})"); print(t.strip())

if __name__ == "__main__":
    main()
