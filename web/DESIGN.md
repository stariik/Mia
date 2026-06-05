---
name: Aetheric Intelligence
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#b9cacb'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#849495'
  outline-variant: '#3b494b'
  surface-tint: '#00dbe9'
  primary: '#dbfcff'
  on-primary: '#00363a'
  primary-container: '#00f0ff'
  on-primary-container: '#006970'
  inverse-primary: '#006970'
  secondary: '#ecb2ff'
  on-secondary: '#520071'
  secondary-container: '#cf5cff'
  on-secondary-container: '#480063'
  tertiary: '#f9f5f5'
  on-tertiary: '#313030'
  tertiary-container: '#dcd9d8'
  on-tertiary-container: '#605e5e'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#7df4ff'
  primary-fixed-dim: '#00dbe9'
  on-primary-fixed: '#002022'
  on-primary-fixed-variant: '#004f54'
  secondary-fixed: '#f8d8ff'
  secondary-fixed-dim: '#ecb2ff'
  on-secondary-fixed: '#320047'
  on-secondary-fixed-variant: '#74009f'
  tertiary-fixed: '#e5e2e1'
  tertiary-fixed-dim: '#c9c6c5'
  on-tertiary-fixed: '#1c1b1b'
  on-tertiary-fixed-variant: '#474646'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display-lg:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '500'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Manrope
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: 0em
  body-md:
    fontFamily: Manrope
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: 0em
  label-sm:
    fontFamily: Manrope
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-padding: 32px
  gutter: 16px
  stack-sm: 4px
  stack-md: 12px
  stack-lg: 24px
---

## Brand & Style
The design system is defined by a sense of "digital presence." It aims to evoke a feeling of high-end intelligence that is both sophisticated and ethereal. The target audience consists of tech-forward individuals who value privacy, speed, and a premium aesthetic.

The design style heavily utilizes **Glassmorphism** and **Minimalism**. UI elements are treated as translucent layers floating in a deep, infinite space. This creates an immersive experience where the interface feels like a heads-up display (HUD) rather than a flat application. The atmosphere is quiet and focused, with sudden bursts of vibrant light and color only when the assistant is active.

## Colors
The palette is rooted in the "Void"—a combination of deep blacks (`#080808`) and slightly lighter charcoal grays (`#121212`) to provide structural depth without breaking the dark immersion. 

- **Primary (Electric Cyan):** Used for active voice states, processing indicators, and primary calls to action. It should appear to "glow" against the dark background.
- **Secondary (Neon Purple):** Used for secondary feedback, AI "thinking" states, and as a gradient partner to the Cyan.
- **Glass Surfaces:** Semi-transparent grays with high saturation blurs (30-50px) to simulate thick, frosted panels.
- **Accents:** High-contrast white for maximum legibility of critical text and icons.

## Typography
This design system uses **Space Grotesk** for headlines to lean into the technical and futuristic narrative. Its geometric construction provides a sharp, engineered feel. **Manrope** is used for body text and labels to ensure a refined, modern, and highly legible experience during long interactions.

Avoid heavy weights for body copy; stick to Regular (400) to maintain an airy, sophisticated feel. Use uppercase labels with generous letter spacing for metadata and small captions to mimic technical readouts.

## Layout & Spacing
The layout follows a **fluid grid** model with generous safe areas to maintain a premium, uncluttered look. Content should be centered or grouped in floating "modules" rather than edge-to-edge blocks.

A strict 8px rhythm governs all padding and margins. Vertical stacks use increased breathing room (24px+) between distinct functional groups to emphasize the minimalist aesthetic. Margins on mobile should not drop below 24px to preserve the "floating" effect of the glass cards.

## Elevation & Depth
Depth is achieved through **Glassmorphism** and **Ambient Shadows** rather than traditional drop shadows.

1.  **The Background (Level 0):** Pure black or a very dark radial gradient.
2.  **The Glass Panel (Level 1):** Background blur (20px-40px) with a 10% white border to define the edge.
3.  **Active Elements (Level 2):** Elements like active buttons or the voice orb use "Outer Glows" using the primary or secondary accent colors. These glows should be soft and wide (blur radius of 30px+) to simulate light emission.
4.  **Information Overlay (Level 3):** Tooltips and temporary popovers use a higher opacity glass and a thin primary-colored top border to signal importance.

## Shapes
The shape language is consistently **Rounded**, striking a balance between organic approachability and technical precision. Standard components use a 0.5rem (8px) radius, while larger glass cards and interactive containers use a more pronounced 1.5rem (24px) radius.

The "Voice Orb"—the central interaction point—is a perfect circle and should utilize fluid, morphing shapes when active to represent the fluid nature of human speech and AI processing.

## Components
- **Buttons:** Primary buttons are semi-transparent with a 1px solid Primary Cyan border. On hover, they fill with a subtle Primary Cyan gradient.
- **Glass Cards:** Used for grouping information. They must have a `backdrop-filter: blur(20px)` and a subtle linear gradient stroke (from top-left to bottom-right) to catch the "light."
- **Icons:** Use thin-line (1px or 1.5px stroke) icons only. Avoid filled icons unless they represent an active toggle state.
- **Voice Activity Indicator:** A central, morphing gradient sphere (Cyan to Purple) that reacts to audio input frequencies.
- **Input Fields:** Minimalist lines or very subtle glass troughs. The focus state is indicated by the bottom border glowing in Primary Cyan.
- **Chips/Tags:** Small, pill-shaped elements with a secondary purple glow to categorize responses or provide quick-reply suggestions.