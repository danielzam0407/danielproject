# Insignia — nerv

> Category: Bold & Expressive
> Technical-brutalist poster grammar. Paper-white or total-black ground, a single electric accent, hairline black rules, wireframe 3D, and instrument-grade data texture.

## 0. The one rule

**Paper white (or total black) + ONE electric accent + hairlines in pure black.
Everything else is information density.**

The style does not come from the colors. It comes from how much technical
information the surface can carry before it becomes illegible — and stopping
one step short of that.

**Lineage:** The Designers Republic → WipEout → early-2000s FUI → *Arknights:
Endfield* → contemporary graphic-core poster art.

**This is NOT "cyberpunk."** The common failure is to render this as neon on
black with glowing terminal green. Here the black is **press paper**, never a
lit screen. If the output looks like a phosphor terminal, you left the lineage.

## 1. Visual Theme & Atmosphere

An instrument readout printed on paper. A page looks like the dump of a machine
that measured something: coordinates everywhere, codes that identify nothing,
wireframes converging on a knot, Japanese type used as texture. It is dense but
it is not busy, because half the surface stays empty.

- **Visual style:** technical, brutal, printed
- **Color stance:** one accent, everything else ink on paper
- **Design intent:** density with a vanishing point. A tangle without focus is
  noise; a tangle with focus is an instrument pointing at something.

## 2. Color

- **Ground:** `#f4f7fc` paper — or `#0a0a0a` total black. **Never mid-grey:**
  without that hard jump the hairlines disappear and the whole grammar falls.
- **Accent:** `#0102ec` electric blue. **One per piece.** Two competing colors
  and this stops being the style — it becomes a control panel.
- **Ink:** `#08123a`. **Rules are `#000000`, pure black, not the ink** — a 1px
  rule in `#08123a` reads grey on paper and loses its edge.
- **Ice:** `#99ccff`, `#6699ff`, `#6e69ff` — washes, dark-ground marks.
- **Exception accents:** `#ff0000` red, `#ccff33` acid. **One per piece, never
  together**, and never alongside the blue.

Print the palette as part of the artwork when it fits: a row of hex codes in
6px mono along a top or bottom edge. Showing the instrument next to the
measurement is native to this grammar.

## 3. Typography

**Three sizes and nothing between them.** The jump IS the style; an
intermediate step turns the page into a magazine.

- **6px mono** — telemetry, id strings, legal micro-copy, found text.
- **9px mono, 3px letter-spacing, uppercase** — specimen labels: `GATE CORE`,
  `SYSTEM NODE`, `ENTRY STATE`.
- **Display** — `clamp(38px, 7vw, 92px)`, weight 700, tracking `-0.035em`.

Rules:
- The display word **never stands alone.** It carries a 2px underline and two
  9px micro-labels flanking it (`set` … `in stone`).
- **CJK is texture, not content.** Vertical Japanese down a margin; one display
  kanji per piece (`観測`, `花`) and never two. It must say something coherent —
  pasting random characters shows, and it shows badly.
- **Found text** — lyrics, a prayer, a scanned document — set at 6–7px and left
  to run. Nobody will read it, and that is the point: it is density, not message.
- Outline (`-webkit-text-stroke`) and vertically-stretched display exist, one
  per piece, and never on the main headline.

## 4. Spacing & Grid

4px base scale. Sections at 78 / 56 / 40px (desktop / tablet / phone).

**The void is an element.** Roughly half the surface stays clean paper. Density
reads by contrast with emptiness, not by accumulation. A page filled corner to
corner is not this style, it is clutter.

## 5. Layout & Composition

- **Rules never close.** A rule runs, turns 90°, runs a short leg and stops.
  A closed rectangle is a box; these are annotations on a plan. Build them with
  `border-top` + `border-right` and a short pseudo-element leg — never a
  four-sided border.
- **Brackets, not frames.** Specimens get four corner brackets (14px arms) with
  no sides.
- **Leader lines are orthogonal.** Label to object in right angles with a small
  accent dot at the end. Never a free diagonal — this is a technical plan, not
  an infographic.
- **Black bars bleed.** The solid bar that redacts, anchors and cuts runs off
  the edge of the frame. A bar that respects the margin does nothing.
- **Everything converges.** Ribbons, splines and hairlines emanate from one
  knot, usually slightly above center.

## 6. Components

The vocabulary, in nine families. Use them; do not invent parallel ones.

| Family | Elements |
|---|---|
| **Ground** | paper · scanned paper (toner grain + fold) · graph grid · total black · photo wash |
| **Rules** | broken frame ← most characteristic · corner brackets · leader line · graduated scale |
| **Data** | seeded telemetry · digit column · barcode · QR block · id strings · legal micro-copy |
| **Type** | underlined display + micro-labels · spaced caps · vertical CJK · display kanji · found text · outline · stretched |
| **Marks** | black bar · chevron · four-point star · warning triangle · crosshair · registration cross · checker tape · format icon strip |
| **Texture** | halftone · dither · pixel mosaic · grain · raster lines |
| **Geometry** | spline burst ← signature element · wireframe sphere/cube · chrome ribbon · star flare |
| **Error** | 2px RGB misregistration · scan slip · ink smear · white vector shards |
| **Legend** | the hex palette printed as part of the artwork |

**Telemetry, specifically.** Scatter 30–50 coordinate readouts (`x: 1349
y: 1344`) at 6px, opacity 0.62, half of them wrapped in small side brackets.
**The numbers must correspond to where they sit** — x grows right, y grows
down. A random number shows; one that corresponds does not. Mark the whole
layer `aria-hidden="true"`: it is texture, and a screen reader reciting forty
fake coordinate pairs is torture.

**Barcodes and QR** derive their bars from a string, so two different codes look
different. They encode nothing and do not pretend to. They are a mark of
provenance, not a shop product.

**All 3D is line work.** Wireframe or pale ribbon, never a shaded solid. That is
precisely why it coexists with the typography instead of competing with it.

## 7. Motion & Interaction

Fast and mechanical: 120–180ms, `cubic-bezier(0.16, 0.84, 0.3, 1)`. Nothing
eases in lazily, nothing floats.

**Nothing invisible waiting for an animation.** Every revealed element needs an
exit to its final state that does not depend on the frame loop — a hidden tab,
a thumbnail capture and a non-compositing renderer all skip it, and without that
exit the content simply never appears.

Generated ornament must be **deterministic**: same seed, same drawing. An
ornament that changes on every reload is noise; one that does not is a mark.

## 8. Voice & Brand

Terse, technical, lowercase. States the thing and stops. No agency filler, no
exclamation marks, no adjectives doing the work of a specification. Labels read
like instrument legends, not like marketing.

**The false information is real.** Coordinates correspond. Codes derive from
their string. Digit columns look like a register and carry no heading. The lie
that holds up is the one with a system behind it.

## 9. Anti-patterns

- **NO glass.** No blur, no soft translucency, no diffuse shadows. Elevation is
  a 1px ring, never a blur. Hard edge or nothing.
- **NO neon on black.** The "cyberpunk" cliché. Here black is press paper.
- **NO rounded corners.** Except circles, which are circles. A single
  `border-radius: 8px` kills the entire vocabulary in one stroke.
- **NO rainbow or iridescent gradients.** Chrome is cold and monochrome. An
  oil-slick gradient is stock-image Y2K.
- **NO CJK as a joke.** It is typographic texture and it says something
  coherent.
- **NO legible telemetry.** If a viewer stops to read the coordinates they are
  too large. 6px, 0.62 opacity, move on.
- **NO second accent.** One signal per piece.
- **NO closed rectangles as decoration.** Rules annotate; they do not contain.
- **NO shaded 3D solids.** Wireframe or pale ribbon only.
- **NO mid-grey backgrounds.** Paper or black. The jump is what makes the
  hairlines exist.

## 10. Accessibility

Density is not an excuse. Texture goes `aria-hidden`; real content stays at a
readable size. Putting the central argument at 7px is showing off the style at
the cost of nobody understanding what it is about.

Measured baseline for the reference sheet: **336 contrast pairs, 46 below
4.5:1, and zero of those in reading text.** The failures are the hex legend
(the element *is* the color), deliberate 6px telemetry, and outline type with a
transparent fill. **If the reading-text column rises above zero, that is a
defect, not a style choice.**
