# Virtual Cat

Virtual Cat is a small Windows and macOS desktop pet inspired by the Linux `oneko` cat. It lives in a transparent, always-on-top Electron window, follows the pointer, sleeps when you are inactive, and stays out of the way of normal clicks.

## Features

- Efficient frame-stepped pixel animation from one 8x5 sprite sheet
- Autonomous roaming with idle, walking, running, and sleeping behavior
- Sleeping after 20 seconds without clicking or touching the cat
- Up/down petting gestures trigger an animated heart reaction
- Strict work-area containment so the cat stays fully visible on screen
- A visibility watchdog that corrects unexpected OS-level window movement
- Atomic fixed-size window movement to prevent DPI-related size growth
- Cached sprite paints and automatic renderer recovery if Chromium drops the transparent surface
- Global-pointer petting detection that ignores window motion
- Click the cat to follow the cursor; click it again to resume free roaming
- Natural occasional blinking without whole-sprite fading
- Direction hysteresis that prevents rapid left/right flipping near a target
- Stable roaming targets without OS move-event feedback loops
- Minimum roaming distance, speed easing, and walk/run transition hysteresis
- Full-display roaming by selecting among far destination candidates
- A tray action to bring a lost cat back to the current pointer display
- Smooth eased movement with multi-monitor work-area safety
- Seam-aware containment across adjacent monitor work areas
- Left/right facing based on travel direction
- Tray controls for visibility, movement, sleep, click-through, always-on-top, and login startup
- Persistent JSON settings in Electron's per-user `userData` folder
- Windows NSIS/portable and macOS DMG packaging

## Requirements

- Node.js and npm
- Windows or macOS

## Development

```sh
npm install
npm start
```

Use the tray icon to control or quit the app. Closing the pet window hides it; it remains available in the tray. The cat roams on its own by default. Click directly on the cat to make it follow the cursor, then click it again to return to roaming.

## Sprite sheet

Place the sprite at `src/assets/cat/cat-spritesheet.png`. It must be an 8x5 grid with eight frames per row:

| Row | Animation |
| --- | --- |
| 0 | Idle |
| 1 | Walking |
| 2 | Running |
| 3 | Sleeping |
| 4 | Loving / heart reaction |

The renderer reads the image's natural dimensions, dividing its width by eight and height by five. Keep every cell the same size and preserve transparent padding consistently. The sprite uses CSS background positioning and `image-rendering: pixelated`.

## Settings

Settings are saved as `settings.json` in Electron's OS-specific `userData` directory. Invalid files safely fall back to defaults. The full settings schema includes movement, sprite scale, sleep delay, debug state label, and animation speed; common toggles are available from the tray.

## Packaging

Create an unpacked application for local testing:

```sh
npm run pack
```

Build Windows NSIS and portable packages on Windows:

```sh
npm run dist:win
```

Build a macOS DMG on macOS:

```sh
npm run dist:mac
```

Outputs are written to `release/`. Add `build/icon.ico`, `build/icon.icns`, and `build/icon.png` before release if custom platform icons are available; electron-builder otherwise uses its defaults.

Builds are currently unsigned. Windows SmartScreen or macOS Gatekeeper may warn recipients, who must explicitly allow the app. Production distribution should add platform code signing and, for macOS, notarization.

## Known limitations

- The tray icon uses the sprite sheet until dedicated platform icons are added.
- Building a macOS DMG generally requires macOS; build each platform on its native OS.
- Advanced settings do not yet have a graphical editor.

## Future improvements

- A small settings window
- Dedicated tray and application icons
- Signed and notarized release builds
- More interactions and animation rows
