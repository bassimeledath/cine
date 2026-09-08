# Recorded input sounds

Physical keyboard and mouse recordings, released as CC0 1.0 by their uploaders:

- **khenshom**, Computer keyboard typing and keystrokes - Apple MacBook Pro 2018: https://freesound.org/people/khenshom/sounds/565645/
- **Pixeliota**, Mouse Click Sound.mp3: https://freesound.org/people/Pixeliota/sounds/678248/
- License: https://creativecommons.org/publicdomain/zero/1.0/

Public HQ MP3 previews were used as the source recordings; no claim of lossless original source quality. See provenance.json for URLs, source hashes, exact cut intervals, processing, and sample hashes. The recorded preset selects among eight keyboard samples with deterministic gain/sample variation. The mouse sample retains physical press/release. Automatic zoom sounds are off by default.

To rebuild from decoded sources: `python3 scripts/prepare-recorded-sounds.py SOURCE_DIR assets/sounds/recorded`. The source directory must contain 48 kHz mono PCM WAVs, the downloaded MP3s, and sources.json. Production renders only read the prepared WAVs and need no network or Python.
