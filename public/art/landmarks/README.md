# Landmark rooftop art

Original top-down rooftop sprites for famous Aarhus buildings, generated with the OpenAI Images API (12 generations, no retries). Style prompt: late-1990s top-down overhead city game, straight-down orthographic, chunky detailed pixel art, gritty saturated palette, hard pixel edges, no text, no logos.
Roofs use `gpt-image-2` (opaque, edge to edge). The stadium and cranes use `gpt-image-1.5` with a transparent background. Originals live in `art-source/landmarks/`; game-ready copies (max 640-768 px, trimmed for the transparent ones) are here. `manifest.json` (own manifest, loaded by BootScene as texture keys `lmart-<key>`) lists them.

Fitting: `scripts/build-map.mjs` matches each landmark to an OSM footprint (see `LANDMARK_BUILDINGS` in `scripts/landmarks.mjs`; by OSM id, then name, then coordinates). `MapRenderer` fits the sprite to the footprint's oriented bounding box, rotated to its long axis, and clips it to the polygon on a canvas texture. `swatch` landmarks (Isbjerget, Den Gamle By, Godsbanen) use the sprite as a roof texture per footprint (random crop). Overlays (Ceres Park, container cranes) are stamped by coordinate; the cranes snap to the nearest quay edge.

| key | mode | OSM match |
|---|---|---|
| lm_aros | fit | way 23568150 |
| lm_dokk1 | fit | way 522107914 |
| lm_domkirke | fit | way 254079854 |
| lm_radhus | fit | way 428972747 |
| lm_isbjerget | swatch | ways 446730040, 446730041, 329409873 (jagged high-rises on Aarhus Ø) |
| lm_gamleby | swatch | 97 footprints inside area way 143766187 |
| lm_salling | fit | way 107363057 |
| lm_aarhush | fit | way 231436752 |
| lm_musikhuset | fit | relation 21395181 |
| lm_godsbanen | swatch | way 1415158056 (ZIGZAG huset) |
| lm_ceres | overlay | approx coordinates (no OSM building) |
| lm_cranes | overlay, quay | nearest sea edge to the container harbour |

## Prompts

### `lm_aarhush`
- model `gpt-image-2`, 1536x1024, quality medium, background auto
- Pure bird's-eye view looking straight down at the ROOF of a building, the roof fills the entire image edge to edge, rectangular frame, no ground, no street, no surroundings, no shadow outside, no perspective, no walls visible. A railway station roof: long grey-green vaulted train-hall roof running left to right over the middle, with several parallel railway tracks and platform edges visible emerging at both ends, station building flat roof section with vents at the top, long axis horizontal. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated palette, hard pixel edges, no perspective, no text, no letters, no logos. 

### `lm_aros`
- model `gpt-image-2`, 1024x1024, quality medium, background auto
- Pure bird's-eye view looking straight down at the ROOF of a building, the roof fills the entire image edge to edge, rectangular frame, no ground, no street, no surroundings, no shadow outside, no perspective, no walls visible. A square modern art museum roof: a flat white and light grey roof with a large circular glass skylight ring on it, the ring edge shows a rainbow of saturated colours (red, orange, yellow, green, blue, violet) around a round opening, plus small roof vents and a thin parapet edge. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated palette, hard pixel edges, no perspective, no text, no letters, no logos. 

### `lm_ceres`
- model `gpt-image-1.5`, 1536x1024, quality medium, background transparent
- A football stadium seen from directly above: an oval stadium bowl with a bright green striped grass pitch with white line markings in the centre, running track ring in red, grandstand roofs in grey and blue all around, floodlight masts. Stadium centred, long axis horizontal, isolated on a fully transparent background, no ground, no shadow. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated palette, hard pixel edges, no perspective, no text, no letters, no logos. 

### `lm_cranes`
- model `gpt-image-1.5`, 1536x1024, quality medium, background transparent
- Two big container harbour gantry cranes seen from directly above, lying side by side parallel to each other, long steel booms stretching horizontally across the image, red and grey steel lattice, trolley, small orange cabins, stacks of colourful shipping containers beneath one boom, isolated on a fully transparent background, no ground, no water, no shadow. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated palette, hard pixel edges, no perspective, no text, no letters, no logos. 

### `lm_dokk1`
- model `gpt-image-2`, 1536x1024, quality medium, background auto
- Pure bird's-eye view looking straight down at the ROOF of a building, the roof fills the entire image edge to edge, rectangular frame, no ground, no street, no surroundings, no shadow outside, no perspective, no walls visible. A large angular low harbourside library roof: faceted slanted grey-silver roof panels with a bold diagonal triangular pattern, a few big skylights and a lighter parapet edge, long axis horizontal. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated palette, hard pixel edges, no perspective, no text, no letters, no logos. 

### `lm_domkirke`
- model `gpt-image-2`, 1536x1024, quality medium, background auto
- Pure bird's-eye view looking straight down at the ROOF of a building, the roof fills the entire image edge to edge, rectangular frame, no ground, no street, no surroundings, no shadow outside, no perspective, no walls visible. A long Gothic cathedral roof in a cross shape: dark steep slate-red tiled ridge roof running left to right along the nave with a transept crossing it, a square west tower at the left end topped by a green copper spire with a cross, buttresses along the edges, long axis horizontal. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated palette, hard pixel edges, no perspective, no text, no letters, no logos. 

### `lm_gamleby`
- model `gpt-image-2`, 1024x1024, quality medium, background auto
- Pure bird's-eye view looking straight down at the ROOF of a building, the roof fills the entire image edge to edge, rectangular frame, no ground, no street, no surroundings, no shadow outside, no perspective, no walls visible. A dense cluster of old half-timbered town houses seen from above: many small steep red clay-tile roofs and some mustard and brown tiled roofs with visible ridge lines, tiny chimneys and dormers, tightly packed like an old market town. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated palette, hard pixel edges, no perspective, no text, no letters, no logos. 

### `lm_godsbanen`
- model `gpt-image-2`, 1024x1024, quality medium, background auto
- Pure bird's-eye view looking straight down at the ROOF of a building, the roof fills the entire image edge to edge, rectangular frame, no ground, no street, no surroundings, no shadow outside, no perspective, no walls visible. An old freight yard cultural centre: a cluster of angular industrial warehouse roofs, sawtooth glazed roof sections, corrugated rusty red and grey-blue metal panels, old rail tracks in between, a zigzag pattern. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated palette, hard pixel edges, no perspective, no text, no letters, no logos. 

### `lm_isbjerget`
- model `gpt-image-2`, 1024x1024, quality medium, background auto
- Pure bird's-eye view looking straight down at the ROOF of a building, the roof fills the entire image edge to edge, rectangular frame, no ground, no street, no surroundings, no shadow outside, no perspective, no walls visible. Roof of a seafront apartment complex shaped like jagged white icebergs: bright white faceted angular roof planes with slight blue-white shading, rows of small bright blue balcony rectangles along the edges, a few rooftop terraces. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated palette, hard pixel edges, no perspective, no text, no letters, no logos. 

### `lm_musikhuset`
- model `gpt-image-2`, 1536x1024, quality medium, background auto
- Pure bird's-eye view looking straight down at the ROOF of a building, the roof fills the entire image edge to edge, rectangular frame, no ground, no street, no surroundings, no shadow outside, no perspective, no walls visible. A concert hall roof: large flat dark roof with a bright glass foyer skylight in teal-blue glass panels with a grid pattern along the front edge, and a sloping copper-grey roof section, vents, long axis horizontal. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated palette, hard pixel edges, no perspective, no text, no letters, no logos. 

### `lm_radhus`
- model `gpt-image-2`, 1024x1024, quality medium, background auto
- Pure bird's-eye view looking straight down at the ROOF of a building, the roof fills the entire image edge to edge, rectangular frame, no ground, no street, no surroundings, no shadow outside, no perspective, no walls visible. A modernist town hall roof clad in pale grey-white marble slabs with flat roof sections, a tall slender square clock tower in one corner seen from above with a dark clock-face-less top and a small cap, rooftop vents. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated palette, hard pixel edges, no perspective, no text, no letters, no logos. 

### `lm_salling`
- model `gpt-image-2`, 1024x1024, quality medium, background auto
- Pure bird's-eye view looking straight down at the ROOF of a building, the roof fills the entire image edge to edge, rectangular frame, no ground, no street, no surroundings, no shadow outside, no perspective, no walls visible. A department store roof: flat grey roof with a rooftop terrace area with wooden decking, a glass balustrade railing, small tables and green potted trees, a glass dome skylight, air-conditioning units and vents. Late-1990s top-down overhead city game art, straight-down orthographic camera, chunky detailed pixel art, gritty saturated palette, hard pixel edges, no perspective, no text, no letters, no logos. 
