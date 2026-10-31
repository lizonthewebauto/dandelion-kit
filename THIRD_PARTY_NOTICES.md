# Third party notices

Dandelion Kit is MIT licensed (see LICENSE). It uses the components below. Each one keeps its own license.

## Bundled in this repository

| Component        | License     | Where                                                      |
| ---------------- | ----------- | ---------------------------------------------------------- |
| Anton            | SIL OFL 1.1 | assets/fonts, assets/font-licenses/Anton-OFL.txt           |
| Archivo Black    | SIL OFL 1.1 | assets/fonts, assets/font-licenses/ArchivoBlack-OFL.txt    |
| Fraunces         | SIL OFL 1.1 | assets/fonts, assets/font-licenses/Fraunces-OFL.txt        |
| IBM Plex Mono    | SIL OFL 1.1 | assets/fonts, assets/font-licenses/IBMPlexMono-OFL.txt     |
| Inter            | SIL OFL 1.1 | assets/fonts, assets/font-licenses/Inter-OFL.txt           |
| Instrument Serif | SIL OFL 1.1 | assets/fonts, assets/font-licenses/InstrumentSerif-OFL.txt |
| Montserrat       | SIL OFL 1.1 | assets/fonts, assets/font-licenses/Montserrat-OFL.txt      |
| Space Mono       | SIL OFL 1.1 | assets/fonts, assets/font-licenses/SpaceMono-OFL.txt       |

The fonts are unmodified upstream releases as published on Google Fonts (the `google/fonts` repository, `ofl/` folder). They are used as separate font files, are not modified and are not sold on their own. Each license text is the standard SIL OFL 1.1 with that font's own copyright line.

## Installed from npm when you first run the kit

| Package                                     | License                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| @modelcontextprotocol/sdk                   | MIT                                                                                                         |
| @modelcontextprotocol/ext-apps              | MIT                                                                                                         |
| zod                                         | MIT                                                                                                         |
| @huggingface/transformers (transformers.js) | Apache-2.0                                                                                                  |
| onnxruntime-node                            | MIT                                                                                                         |
| satori                                      | MPL-2.0                                                                                                     |
| sharp                                       | Apache-2.0 (the libvips library it loads is LGPL-3.0 or later; it is linked dynamically and is not changed) |
| open                                        | MIT                                                                                                         |

Development only: typescript (Apache-2.0), prettier (MIT), @types/node (MIT).

## Downloaded on first use (not stored in this repository)

| Item                                                                | License              | Notes                                                                                                 |
| ------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| Whisper speech model, ONNX conversion `onnx-community/whisper-base` | MIT (OpenAI Whisper) | About 75 MB, fetched once into `~/.dandelion-kit/models`. Check the model card for the current terms. |
| YuNet face detection model (`face_detection_yunet_2023mar.onnx`)    | MIT (OpenCV Zoo)     | About 230 KB, fetched once into `~/.dandelion-kit/models`.                                            |

## Not shipped

ffmpeg is detected on your computer, or the kit shows the install command for your system. It is never included in this repository or in a release, so its license (LGPL or GPL depending on the build you install) applies to your own copy only.
