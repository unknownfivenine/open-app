# Electronic sound: AMB-1 engine

OPEN's electronic sound is the generative engine of **AMB-1** by Charles Vestal
(https://github.com/charlesvestal/fm1-amb), used unchanged under the **Mozilla Public License 2.0**
(`LICENSE` in this folder). OPEN only chooses its settings over time; it does not alter the engine.

| File | Origin | Licence |
| --- | --- | --- |
| `src/amb.c`, `src/amb.h`, `src/amb_api.c` | fm1-amb commit da0047dc468a7f4f299e0d54fd12bac0c0c11a96 (`app/dsp/`, `web/app/`) | MPL-2.0, unmodified |
| `src/fastmath.h` | fm1-base commit 3ae2a65ddd02e15bf9ce925b5a7136d5d207ee25 (`include/`) | MPL-2.0, unmodified |
| `amb.wasm` | built from the files above | MPL-2.0 |
| `worklet.js` | written for OPEN after fm1-amb's `web/app/worklet.js` | MPL-2.0 |

Build from this folder (clang 18, no Emscripten needed):

    clang --target=wasm32 -O2 -ffp-contract=off -std=gnu99 -nostdlib -ffreestanding -DEN_HOST -Isrc \
      -Wl,--no-entry -Wl,--export-dynamic -Wl,--initial-memory=8388608 -Wl,-z,stack-size=262144 \
      -Wl,--allow-undefined -o amb.wasm src/amb_api.c src/amb.c

AMB-1's idea comes from Brian Eno's *Music for Airports* and *Discreet Music*; its reverb is Jon
Dattorro's plate. "M-VAVE" and "FM-1" are trademarks of their owners; OPEN is not affiliated with them.
