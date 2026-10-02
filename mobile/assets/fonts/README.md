# Font assets

React Native uses the `.ttf` filename stem (no extension) as the `fontFamily`
value on Android. Every file here must also be copied to
`android/app/src/main/assets/fonts/` and registered in `src/theme/fontFiles.ts`
(Expo Go / iOS load them at runtime from there).

- `FiraGO-Regular.ttf`, `FiraGO-Medium.ttf`, `FiraGO-SemiBold.ttf` — the text
  family (Georgian, Latin, Cyrillic). From bBoxType/FiraGO 1.001, subset with
  fontTools to Latin + Latin Extended + Cyrillic + Georgian + punctuation,
  arrows and currency (≈295 KB each instead of ≈800 KB). License: `OFL-FiraGO.txt`.
- `Fredoka-SemiBold.ttf` — the "Mia" wordmark only. A static weight-600 /
  width-100 instance of Google Fonts' variable `Fredoka[wdth,wght].ttf`, subset
  to Latin-1 (≈33 KB). License: `OFL-Fredoka.txt`.

To re-subset after adding a script:

```
python3 -m fontTools.subset FiraGO-Regular.ttf \
  --unicodes="U+0000-024F,U+0300-036F,U+0400-04FF,U+10A0-10FF,U+2000-206F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2212,U+2215,U+25CF,U+2713,U+FEFF,U+FFFD" \
  --layout-features='*' --glyph-names --notdef-outline --name-IDs='*' \
  --name-languages='*' --drop-tables+=DSIG --output-file=FiraGO-Regular.ttf
```
