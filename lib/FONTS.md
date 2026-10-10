# The PDF fonts

`public/fonts/bs-sans.ttf` and `bs-sans-bold.ttf` are **subsets of DejaVu Sans**,
cut down to the characters a Betterservice document can actually contain.

## Why they exist

The fourteen fonts built into every PDF reader are encoded in WinAnsi, which has
no macron vowels. Drawing "Māori" with one of them loses the `ā` silently in
jsPDF, and throws outright in pdf-lib — which is what left rental invoice #01065
with no PDF on 10 Oct 2026. `lib/pdfFont.js` has the full account.

## Why they are subsets

jsPDF embeds whatever font file you give it **whole, in every document**. Full
DejaVu Sans plus its bold is 1.4 MB on every invoice, and a 2.6 MB invoice is
already known to be too big for Craig's iPad to email (see `lib/pdfLogo.js`).
The subsets are 17 KB and 16 KB, about 13 KB once jsPDF compresses them.

## What is in them

| Range | What for |
|---|---|
| `U+0020`–`U+007E` | printable ASCII |
| `U+00A0`–`U+00FF` | Latin-1 — é, ö, ñ and friends |
| `U+0100-0101`, `U+0112-0113`, `U+012A-012B`, `U+014C-014D`, `U+016A-016B` | Ā ā Ē ē Ī ī Ō ō Ū ū — the te reo macrons |
| `U+2010`–`U+2015`, `U+2018`–`U+201D`, `U+2022`, `U+2026`, `U+20AC`, `U+2122` | dashes, curly quotes, bullet, ellipsis, € and ™ as they arrive pasted out of Word and email |

**A character outside that list will not print.** It disappears exactly the way
the macrons used to, and nothing will warn you. If a customer's name ever needs
one, regenerate the subsets rather than reaching for the full font.

## Regenerating them

```bash
pip install fonttools
curl -O https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf
curl -O https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans-Bold.ttf

CHARS='U+0020-007E,U+00A0-00FF,U+0100-0101,U+0112-0113,U+012A-012B,U+014C-014D,U+016A-016B,U+2010-2015,U+2018-2019,U+201C-201D,U+2022,U+2026,U+20AC,U+2122'

pyftsubset DejaVuSans.ttf      --unicodes="$CHARS" --no-hinting --desubroutinize \
  --drop-tables+=GSUB,GPOS,GDEF,morx,kerx,BASE,JSTF,DSIG,LTSH,hdmx,VDMX,PCLT \
  --output-file=public/fonts/bs-sans.ttf
pyftsubset DejaVuSans-Bold.ttf --unicodes="$CHARS" --no-hinting --desubroutinize \
  --drop-tables+=GSUB,GPOS,GDEF,morx,kerx,BASE,JSTF,DSIG,LTSH,hdmx,VDMX,PCLT \
  --output-file=public/fonts/bs-sans-bold.ttf
```

Then print one invoice for a customer with a macron in their name and look at it.

## Licence

DejaVu Sans is free to use, modify, embed and redistribute, including subsets,
under the DejaVu Fonts License (a Bitstream Vera derivative) —
<https://dejavu-fonts.github.io/License.html>. The one condition that bites is
the name: a modified version may not be sold on its own or shipped under the
reserved names "DejaVu" or "Bitstream Vera", which is why these files are called
`bs-sans`.
