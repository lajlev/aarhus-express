# Aarhus Express art

Original artwork generated for the game. All images were made with the OpenAI Images API (`/v1/images/generations`). The Gemini API key in the environment was rejected (API_KEY_INVALID), so no Gemini/Imagen images were used.
Transparent sprites use `gpt-image-1.5` (`background: transparent`; `gpt-image-2` does not support transparency). Tiles, key art and portraits use `gpt-image-2`.
Derived files (`_trim`, `_64`, `_48`, `_32`, `_128`, `_512`, `_crop`, `_1280`) were made locally with Pillow (trim to alpha bounds, Lanczos resize, 16:9 centre crop).

`manifest.json` maps asset keys to files. **Only the game-ready sizes live in `public/art/`** (`_32`, `_48`, `_64`, `_128`, `_512`, `_1280`, plus this README and the manifest) so Vite ships ~5 MB. The full-size originals, `_trim` and `_crop` files were moved to `art-source/` at the project root (same sub-folders, not shipped). In the README below, paths starting with `art-source/` are in that folder; paths starting with `art/` are in `public/art/`. In the manifest `game`/`small` are relative to `public/`, while `src`/`raw` are relative to the project root.

In-game wiring: `BootScene` loads the manifest and every non-tile `game` image, then `applyArt()` in `src/world/textures.js` bakes them over the programmatic texture keys (`veh-*`, `char-*`, `ped-0..5`, `marker-*`, `icon-*`). Add `?noart` to the URL to see the programmatic fallbacks.

## characters

### `char_art_student`
- Original: `art-source/characters/art_student.png` (1024x1024, 1454 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/characters/art_student_trim.png` (589x652, 611 KB)
- Derived: `art/characters/art_student_48.png` (43x48, 4 KB)
- Derived: `art/characters/art_student_32.png` (29x32, 2 KB)
- Prompt: Game sprite of an art student courier with a messy dyed-pink bob haircut, paint-splattered denim jacket, big sketch portfolio under the arm. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single character sprite only, centered, viewed from directly above (bird's-eye, top of the head and shoulders visible, arms and feet slightly visible), facing the top of the image, standing pose, small readable silhouette with bold colours, isolated on a fully transparent background, no ground, no shadow, no scenery.

### `char_barista`
- Original: `art-source/characters/barista.png` (1024x1024, 1395 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/characters/barista_trim.png` (654x498, 487 KB)
- Derived: `art/characters/barista_48.png` (48x37, 4 KB)
- Derived: `art/characters/barista_32.png` (32x24, 2 KB)
- Prompt: Game sprite of a slim young barista courier seen from above: top of head with a dark brown man bun, shoulders in a navy and white striped shirt, brown apron straps, one hand holding a white takeaway coffee cup out to the side. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single character sprite only, centered, viewed from directly above (bird's-eye, top of the head and shoulders visible, arms and feet slightly visible), facing the top of the image, standing pose, small readable silhouette with bold colours, isolated on a fully transparent background, no ground, no shadow, no scenery.

### `char_dock_worker`
- Original: `art-source/characters/dock_worker.png` (1024x1024, 1371 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/characters/dock_worker_trim.png` (628x546, 483 KB)
- Derived: `art/characters/dock_worker_48.png` (48x42, 4 KB)
- Derived: `art/characters/dock_worker_32.png` (32x28, 2 KB)
- Prompt: Game sprite of a burly harbour dock worker courier in an orange high-visibility vest and yellow hard hat, broad shoulders. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single character sprite only, centered, viewed from directly above (bird's-eye, top of the head and shoulders visible, arms and feet slightly visible), facing the top of the image, standing pose, small readable silhouette with bold colours, isolated on a fully transparent background, no ground, no shadow, no scenery.

### `char_pedestrian`
- Original: `art-source/characters/pedestrian.png` (1024x1024, 1342 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/characters/pedestrian_trim.png` (411x471, 278 KB)
- Derived: `art/characters/pedestrian_48.png` (42x48, 4 KB)
- Derived: `art/characters/pedestrian_32.png` (28x32, 2 KB)
- Prompt: Game sprite of a generic Danish city pedestrian in a dark grey coat with a tote bag, plain hair. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single character sprite only, centered, viewed from directly above (bird's-eye, top of the head and shoulders visible, arms and feet slightly visible), facing the top of the image, standing pose, small readable silhouette with bold colours, isolated on a fully transparent background, no ground, no shadow, no scenery.

### `char_police_officer`
- Original: `art-source/characters/police_officer.png` (1024x1024, 1381 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/characters/police_officer_trim.png` (598x641, 545 KB)
- Derived: `art/characters/police_officer_48.png` (45x48, 4 KB)
- Derived: `art/characters/police_officer_32.png` (30x32, 2 KB)
- Prompt: Game sprite of a police officer in a dark navy uniform with fluorescent yellow-green reflective vest and a peaked cap. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single character sprite only, centered, viewed from directly above (bird's-eye, top of the head and shoulders visible, arms and feet slightly visible), facing the top of the image, standing pose, small readable silhouette with bold colours, isolated on a fully transparent background, no ground, no shadow, no scenery.

### `char_superfan`
- Original: `art-source/characters/superfan.png` (1024x1024, 1409 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/characters/superfan_trim.png` (579x584, 515 KB)
- Derived: `art/characters/superfan_48.png` (48x48, 5 KB)
- Derived: `art/characters/superfan_32.png` (32x32, 2 KB)
- Prompt: Game sprite of a football superfan courier in a bright white and sky-blue striped football scarf and matching jersey, face paint, waving one arm. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single character sprite only, centered, viewed from directly above (bird's-eye, top of the head and shoulders visible, arms and feet slightly visible), facing the top of the image, standing pose, small readable silhouette with bold colours, isolated on a fully transparent background, no ground, no shadow, no scenery.

### `char_tram_driver`
- Original: `art-source/characters/tram_driver.png` (1024x1024, 1351 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/characters/tram_driver_trim.png` (608x546, 453 KB)
- Derived: `art/characters/tram_driver_48.png` (48x43, 4 KB)
- Derived: `art/characters/tram_driver_32.png` (32x29, 2 KB)
- Prompt: Game sprite of a retired tram driver courier seen from above: top of a solid navy peaked uniform cap, grey beard edges visible, navy blue uniform jacket with brass buttons on the shoulders, every pixel of the figure fully opaque. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single character sprite only, centered, viewed from directly above (bird's-eye, top of the head and shoulders visible, arms and feet slightly visible), facing the top of the image, standing pose, small readable silhouette with bold colours, isolated on a fully transparent background, no ground, no shadow, no scenery.

## keyart

### `keyart`
- Original: `art-source/keyart/keyart_16x9.png` (1536x1024, 3320 KB) - OpenAI `gpt-image-2`, quality high, size 1536x1024, background auto
- Derived: `art-source/keyart/keyart_16x9_crop.png` (1536x864, 2562 KB)
- Derived: `art/keyart/keyart_16x9_1280.png` (1280x720, 1843 KB)
- Prompt: Wide marketing key art illustration for an original top-down city driving game set in Aarhus, Denmark. Overhead bird's-eye view straight down onto a busy Danish harbour-city street at dusk: a courier on a yellow long-john cargo bike loaded with parcels speeding along a riverside street with café tables and umbrellas along a narrow canal-like river, chased by two white, yellow-green and blue checkered police cars with flashing blue lights. Red tile and green copper rooftops of old townhouses, a cobblestone lane, a modern white light-rail tram on tracks, and on one side the harbour with dark water, angular modern white waterfront apartment blocks, cranes and stacked shipping containers. On one museum rooftop a circular rainbow-coloured glass walkway ring. Chunky detailed pixel art, late-1990s overhead city game look, gritty saturated palette, hard pixel edges, dramatic headlight glow. No text, no letters, no logos, no UI.

## portraits

### `portrait_art_student`
- Original: `art-source/portraits/art_student.png` (1024x1536, 2674 KB) - OpenAI `gpt-image-2`, quality medium, size 1024x1536, background auto
- Derived: `art/portraits/art_student_512.png` (512x768, 722 KB)
- Prompt: Character select portrait card, chest-up, three-quarter view, of a Danish art student with a messy pink bob, paint-splattered denim jacket and round glasses, background of a museum rooftop with a circular rainbow-coloured glass ring. Chunky detailed pixel art in a late-1990s city game style, gritty saturated palette, hard pixel edges, strong rim light, framed vertical card composition. Original character. No text, no letters, no logos, no UI.

### `portrait_barista`
- Original: `art-source/portraits/barista.png` (1024x1536, 2209 KB) - OpenAI `gpt-image-2`, quality medium, size 1024x1536, background auto
- Derived: `art/portraits/barista_512.png` (512x768, 605 KB)
- Prompt: Character select portrait card, chest-up, three-quarter view, of a young Danish barista with a man bun and short beard, brown apron over a striped shirt, holding a takeaway coffee, background of a cosy riverside café street with warm lights. Chunky detailed pixel art in a late-1990s city game style, gritty saturated palette, hard pixel edges, strong rim light, framed vertical card composition. Original character. No text, no letters, no logos, no UI.

### `portrait_dock_worker`
- Original: `art-source/portraits/dock_worker.png` (1024x1536, 2096 KB) - OpenAI `gpt-image-2`, quality medium, size 1024x1536, background auto
- Derived: `art/portraits/dock_worker_512.png` (512x768, 588 KB)
- Prompt: Character select portrait card, chest-up, three-quarter view, of a burly Danish dock worker in an orange hi-vis vest and yellow hard hat, stubble, background of harbour cranes and stacked shipping containers at dusk. Chunky detailed pixel art in a late-1990s city game style, gritty saturated palette, hard pixel edges, strong rim light, framed vertical card composition. Original character. No text, no letters, no logos, no UI.

### `portrait_superfan`
- Original: `art-source/portraits/superfan.png` (1024x1536, 2122 KB) - OpenAI `gpt-image-2`, quality medium, size 1024x1536, background auto
- Derived: `art/portraits/superfan_512.png` (512x768, 650 KB)
- Prompt: Character select portrait card, chest-up, three-quarter view, of an exuberant Danish football superfan with white and sky-blue face paint and a striped scarf held up, background of a stadium floodlight glow. Chunky detailed pixel art in a late-1990s city game style, gritty saturated palette, hard pixel edges, strong rim light, framed vertical card composition. Original character. No text, no letters, no logos, no UI.

### `portrait_tram_driver`
- Original: `art-source/portraits/tram_driver.png` (1024x1536, 2098 KB) - OpenAI `gpt-image-2`, quality medium, size 1024x1536, background auto
- Derived: `art/portraits/tram_driver_512.png` (512x768, 575 KB)
- Prompt: Character select portrait card, chest-up, three-quarter view, of a cheerful retired Danish tram driver with a grey beard, flat cap and navy uniform with brass buttons, background of a modern light-rail tram at a city stop. Chunky detailed pixel art in a late-1990s city game style, gritty saturated palette, hard pixel edges, strong rim light, framed vertical card composition. Original character. No text, no letters, no logos, no UI.

## tiles

### `tile_asphalt`
- Original: `art-source/tiles/asphalt.png` (1024x1024, 2095 KB) - OpenAI `gpt-image-2`, quality medium, size 1024x1024, background auto
- Derived: `art/tiles/asphalt_128.png` (128x128, 27 KB)
- Prompt: Top-down game ground tile: plain dark grey city asphalt road surface with fine grit, small cracks and faint oil stains. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Seamless tileable square texture, viewed straight down, fills the entire frame edge to edge, no border, no vignette, uniform lighting, edges wrap perfectly when tiled, no objects, no text.

### `tile_cobblestone`
- Original: `art-source/tiles/cobblestone.png` (1024x1024, 2093 KB) - OpenAI `gpt-image-2`, quality medium, size 1024x1024, background auto
- Derived: `art/tiles/cobblestone_128.png` (128x128, 33 KB)
- Prompt: Top-down game ground tile: old Danish medieval-quarter cobblestone street, rounded grey and brown granite cobbles set in rows. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Seamless tileable square texture, viewed straight down, fills the entire frame edge to edge, no border, no vignette, uniform lighting, edges wrap perfectly when tiled, no objects, no text.

### `tile_grass`
- Original: `art-source/tiles/grass.png` (1024x1024, 2105 KB) - OpenAI `gpt-image-2`, quality medium, size 1024x1024, background auto
- Derived: `art/tiles/grass_128.png` (128x128, 36 KB)
- Prompt: Top-down game ground tile: city park lawn grass, varied greens, small clover and a few tiny daisies. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Seamless tileable square texture, viewed straight down, fills the entire frame edge to edge, no border, no vignette, uniform lighting, edges wrap perfectly when tiled, no objects, no text.

### `tile_pavement`
- Original: `art-source/tiles/pavement.png` (1024x1024, 2439 KB) - OpenAI `gpt-image-2`, quality medium, size 1024x1024, background auto
- Derived: `art/tiles/pavement_128.png` (128x128, 28 KB)
- Prompt: Top-down game ground tile: Danish city sidewalk of square light grey concrete paving slabs with a grid of joints, with a few bands of small granite setts. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Seamless tileable square texture, viewed straight down, fills the entire frame edge to edge, no border, no vignette, uniform lighting, edges wrap perfectly when tiled, no objects, no text.

### `tile_road_lanes`
- Original: `art-source/tiles/road_lanes.png` (1024x1024, 1465 KB) - OpenAI `gpt-image-2`, quality medium, size 1024x1024, background auto
- Derived: `art/tiles/road_lanes_128.png` (128x128, 28 KB)
- Prompt: Top-down game ground tile: dark grey asphalt road with a dashed white centre lane marking running vertically through the exact middle of the tile, the dash pattern repeating cleanly top to bottom. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Seamless tileable square texture, viewed straight down, fills the entire frame edge to edge, no border, no vignette, uniform lighting, edges wrap perfectly when tiled, no objects, no text.

### `tile_roof_copper`
- Original: `art-source/tiles/roof_copper.png` (1024x1024, 1947 KB) - OpenAI `gpt-image-2`, quality medium, size 1024x1024, background auto
- Derived: `art/tiles/roof_copper_128.png` (128x128, 29 KB)
- Prompt: Top-down game ground tile: weathered green copper patina rooftop with vertical standing seams, verdigris streaks. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Seamless tileable square texture, viewed straight down, fills the entire frame edge to edge, no border, no vignette, uniform lighting, edges wrap perfectly when tiled, no objects, no text.

### `tile_roof_flat_grey`
- Original: `art-source/tiles/roof_flat_grey.png` (1024x1024, 2324 KB) - OpenAI `gpt-image-2`, quality medium, size 1024x1024, background auto
- Derived: `art/tiles/roof_flat_grey_128.png` (128x128, 26 KB)
- Prompt: Top-down game ground tile: flat grey bitumen commercial rooftop with seams, gravel patches and small vents. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Seamless tileable square texture, viewed straight down, fills the entire frame edge to edge, no border, no vignette, uniform lighting, edges wrap perfectly when tiled, no objects, no text.

### `tile_roof_red_tile`
- Original: `art-source/tiles/roof_red_tile.png` (1024x1024, 1560 KB) - OpenAI `gpt-image-2`, quality medium, size 1024x1024, background auto
- Derived: `art/tiles/roof_red_tile_128.png` (128x128, 34 KB)
- Prompt: Top-down game ground tile: red clay tile rooftop of an old Danish townhouse, rows of overlapping curved terracotta tiles. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Seamless tileable square texture, viewed straight down, fills the entire frame edge to edge, no border, no vignette, uniform lighting, edges wrap perfectly when tiled, no objects, no text.

### `tile_water`
- Original: `art-source/tiles/water.png` (1024x1024, 1612 KB) - OpenAI `gpt-image-2`, quality medium, size 1024x1024, background auto
- Derived: `art/tiles/water_128.png` (128x128, 34 KB)
- Prompt: Top-down game ground tile: dark green-blue harbour water with small choppy ripples and light glints. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Seamless tileable square texture, viewed straight down, fills the entire frame edge to edge, no border, no vignette, uniform lighting, edges wrap perfectly when tiled, no objects, no text.

## ui

### `icon_heart`
- Original: `art-source/ui/icon_heart.png` (1024x1024, 1331 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/ui/icon_heart_trim.png` (562x520, 387 KB)
- Derived: `art/ui/icon_heart_32.png` (32x30, 2 KB)
- Prompt: Game icon of a chunky red heart with a small smiling face and a sparkle, representing life quality. Late-1990s city game interface icon, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single game icon, centered, bold dark pixel outline, readable at 32 pixels, isolated on a fully transparent background, no text, no letters, no numbers.

### `icon_heat`
- Original: `art-source/ui/icon_heat.png` (1024x1024, 1379 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/ui/icon_heat_trim.png` (530x493, 390 KB)
- Derived: `art/ui/icon_heat_32.png` (32x30, 2 KB)
- Prompt: Game icon of a blue police-style star badge with a flashing light glow, representing police wanted level. Late-1990s city game interface icon, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single game icon, centered, bold dark pixel outline, readable at 32 pixels, isolated on a fully transparent background, no text, no letters, no numbers.

### `icon_money`
- Original: `art-source/ui/icon_money.png` (1024x1024, 1397 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/ui/icon_money_trim.png` (646x418, 421 KB)
- Derived: `art/ui/icon_money_32.png` (32x21, 1 KB)
- Prompt: Game icon of a small stack of Danish-style paper banknotes and a gold coin with a hole in the middle. Late-1990s city game interface icon, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single game icon, centered, bold dark pixel outline, readable at 32 pixels, isolated on a fully transparent background, no text, no letters, no numbers.

### `icon_phone`
- Original: `art-source/ui/icon_phone.png` (1024x1024, 1403 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/ui/icon_phone_trim.png` (633x753, 679 KB)
- Derived: `art/ui/icon_phone_32.png` (27x32, 2 KB)
- Prompt: Game icon of a chunky retro clamshell mobile phone with a green screen and a small vibration zigzag, delivery job pager. Late-1990s city game interface icon, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single game icon, centered, bold dark pixel outline, readable at 32 pixels, isolated on a fully transparent background, no text, no letters, no numbers.

### `marker_dropoff`
- Original: `art-source/ui/marker_dropoff.png` (1024x1024, 820 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/ui/marker_dropoff_trim.png` (690x544, 484 KB)
- Derived: `art/ui/marker_dropoff_64.png` (64x50, 6 KB)
- Prompt: Game icon of a drop-off map marker: a glowing orange-red circular ground ring with a downward arrow onto a target cross in the middle, seen from above. Late-1990s city game interface icon, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single game icon, centered, bold dark pixel outline, readable at 32 pixels, isolated on a fully transparent background, no text, no letters, no numbers.

### `marker_pickup`
- Original: `art-source/ui/marker_pickup.png` (1024x1024, 1326 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/ui/marker_pickup_trim.png` (667x569, 536 KB)
- Derived: `art/ui/marker_pickup_64.png` (64x55, 6 KB)
- Prompt: Game icon of a pickup map marker: a glowing green circular ground ring with a cardboard parcel box and an upward arrow in the middle, seen from above. Late-1990s city game interface icon, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single game icon, centered, bold dark pixel outline, readable at 32 pixels, isolated on a fully transparent background, no text, no letters, no numbers.

## vehicles

### `vehicle_bus`
- Original: `art-source/vehicles/bus.png` (1024x1536, 2.2 MB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1536, background transparent (JOBS specialist, one generation)
- Derived: `art-source/vehicles/bus_trim.png` (399x1254), `art/vehicles/bus_64.png` (64x201)
- Prompt: Game sprite of a long Danish city bus, a single rigid 12 metre low-floor diesel bus seen from directly above: flat roof with air-conditioning units and hatches, painted yellow with a wide dark grey roof stripe along its length, windscreen at the top, rear engine cover at the bottom, rounded corners, black wing mirrors sticking out at the front corners, no markings. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single sprite only, centered, viewed from directly above, front of the vehicle pointing to the top of the image, perfectly symmetrical left-right, isolated on a fully transparent background.

### `vehicle_cargo_bike`
- Original: `art-source/vehicles/cargo_bike.png` (1024x1024, 1431 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/vehicles/cargo_bike_trim.png` (339x986, 517 KB)
- Derived: `art/vehicles/cargo_bike_64.png` (64x186, 18 KB)
- Prompt: Game sprite of a Danish long-john front-loading cargo bicycle, travelling toward the top of the image: front wheel at the very top, then the wooden cargo box with parcels in the upper half, then the handlebars, then the rider in a yellow rain jacket seen from above in the lower half, rear wheel at the bottom. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single sprite only, centered, filling most of the frame, viewed from directly above (bird's-eye, 90 degrees down), front of the vehicle pointing to the top of the image, perfectly symmetrical left-right, small dark drop outline, isolated on a fully transparent background, no shadow on the ground, no scenery.

### `vehicle_delivery_van`
- Original: `art-source/vehicles/delivery_van.png` (1024x1024, 1435 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/vehicles/delivery_van_trim.png` (496x891, 656 KB)
- Derived: `art/vehicles/delivery_van_64.png` (64x115, 12 KB)
- Prompt: Game sprite of a white boxy courier delivery panel van with a red stripe along the roof edges, roof vents, windscreen at the top. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single sprite only, centered, filling most of the frame, viewed from directly above (bird's-eye, 90 degrees down), front of the vehicle pointing to the top of the image, perfectly symmetrical left-right, small dark drop outline, isolated on a fully transparent background, no shadow on the ground, no scenery.

### `vehicle_hatchback`
- Original: `art-source/vehicles/hatchback.png` (1024x1024, 1348 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/vehicles/hatchback_trim.png` (567x858, 622 KB)
- Derived: `art/vehicles/hatchback_64.png` (64x97, 9 KB)
- Prompt: Game sprite of a small boxy European compact hatchback car in faded teal, sunroof, roof visible, windscreen at the top. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single sprite only, centered, filling most of the frame, viewed from directly above (bird's-eye, 90 degrees down), front of the vehicle pointing to the top of the image, perfectly symmetrical left-right, small dark drop outline, isolated on a fully transparent background, no shadow on the ground, no scenery.

### `vehicle_police_car`
- Original: `art-source/vehicles/police_car.png` (1024x1024, 1354 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/vehicles/police_car_trim.png` (407x822, 439 KB)
- Derived: `art/vehicles/police_car_64.png` (64x129, 12 KB)
- Prompt: Game sprite of a Danish-style police estate car with a fully solid opaque body: white roof with a blue light bar across it, sides in fluorescent yellow-green and blue battenburg checks, opaque dark tinted glass windscreen at the top and rear window at the bottom, bonnet at the top, every pixel of the car fully opaque. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single sprite only, centered, filling most of the frame, viewed from directly above (bird's-eye, 90 degrees down), front of the vehicle pointing to the top of the image, perfectly symmetrical left-right, small dark drop outline, isolated on a fully transparent background, no shadow on the ground, no scenery.

### `vehicle_scooter`
- Original: `art-source/vehicles/scooter.png` (1024x1024, 1412 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1024, background transparent
- Derived: `art-source/vehicles/scooter_trim.png` (439x924, 592 KB)
- Derived: `art/vehicles/scooter_64.png` (64x135, 14 KB)
- Prompt: Game sprite of a small retro moped scooter with a delivery top box on the back, rider with a white helmet seen from above. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single sprite only, centered, filling most of the frame, viewed from directly above (bird's-eye, 90 degrees down), front of the vehicle pointing to the top of the image, perfectly symmetrical left-right, small dark drop outline, isolated on a fully transparent background, no shadow on the ground, no scenery.

### `vehicle_tram`
- Original: `art-source/vehicles/tram.png` (1024x1536, 2290 KB) - OpenAI `gpt-image-1.5`, quality medium, size 1024x1536, background transparent
- Derived: `art-source/vehicles/tram_trim.png` (249x1375, 674 KB)
- Derived: `art/vehicles/tram_64.png` (64x353, 47 KB)
- Prompt: Game sprite of a long modern articulated light-rail tram in white and pale blue, three connected sections with flexible joints, roof pantograph and cooling units, cab at the top. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated urban palette, hard pixel edges, no perspective, no text, no letters, no logos. Single sprite only, centered, filling most of the frame, viewed from directly above (bird's-eye, 90 degrees down), front of the vehicle pointing to the top of the image, perfectly symmetrical left-right, small dark drop outline, isolated on a fully transparent background, no shadow on the ground, no scenery.

## bikes (added for the bike update)

All `gpt-image-1.5`, quality medium, background transparent. 4 generations in total (city bike was regenerated once). Registered in `src/world/textures.js` as `veh-bike` (parked/empty), `veh-bike-rider` (ridden, used for AI cyclists and the player) and `prop-bikerack` (manifest group `props`). The rack is drawn empty; bikes are real vehicles placed in its slots.

### `vehicle_city_bike`
- Original: `art-source/vehicles/city_bike.png`
- Derived: `art-source/vehicles/city_bike_trim.png`, `art/vehicles/city_bike_48.png`
- Prompt (abridged): Game sprite of a riderless parked classic Danish city bicycle with a teal painted frame, chrome upright handlebars, brown leather saddle, wire basket on the rear rack ... front pointing to the top (pixel-art style prompt; 2nd attempt, the 1st came out as a dark 3D render).

### `vehicle_city_bike_rider`
- Original: `art-source/vehicles/city_bike_rider.png`
- Derived: `art-source/vehicles/city_bike_rider_trim.png`, `art/vehicles/city_bike_rider_64.png`
- Prompt (abridged): Game sprite of a Danish commuter cycling on a classic black city bicycle, cyclist in a bright red jacket and dark cap seen from directly above ...

### `prop_bike_rack`
- Original: `art-source/props/bike_rack.png`
- Derived: `art-source/props/bike_rack_trim.png`, `art/props/bike_rack_192.png`
- Prompt (abridged): Game sprite of an empty row of grey galvanised steel bicycle rack hoops on a concrete strip with no bicycles, seven hoops, seen from directly above (size 1536x1024).

