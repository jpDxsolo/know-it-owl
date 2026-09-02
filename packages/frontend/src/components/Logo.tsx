/**
 * The owl.
 *
 * The artwork already contains the "KNOW IT OWL" wordmark, so nothing that
 * renders this should add a text heading beside it — that reads as the name
 * twice.
 *
 * Both treatments are offered at several widths through a srcset. The detail is
 * the point — the glasses, the book, the lightbulb — but a phone on pub wifi
 * should not download the 680KB version that only a desktop display can
 * resolve, so the browser is told the rendered size and left to choose.
 *
 * The mark used to take the 256px file unconditionally, which was fine while it
 * rendered at 40px. At 128px on a retina display that file is exactly the pixels
 * needed and nothing spare, so it now reaches for the 512 when the display
 * warrants it and still takes the small one on a phone.
 */
import "./Logo.css";

export interface LogoProps {
  /** Intrinsic hint only; the rendered box is sized in CSS. */
  size?: number;
  /** The hero treatment on the Join screen, versus the small header mark. */
  variant?: "hero" | "mark";
}

/** Must track `.kio-logo--hero` in Logo.css, or the browser picks the wrong file. */
const HERO_SIZES = "(min-width: 40rem) 20rem, min(62vw, 17rem)";

/** Likewise `.kio-logo--mark`. */
const MARK_SIZES = "(min-width: 40rem) 8rem, 3.5rem";

export function Logo({ size = 128, variant = "mark" }: LogoProps) {
  const hero = variant === "hero";
  return (
    <img
      className={`kio-logo kio-logo--${variant}`}
      src={hero ? "/owl-512.png" : "/owl-256.png"}
      srcSet={
        hero
          ? "/owl-256.png 256w, /owl-512.png 512w, /owl-768.png 768w"
          : "/owl-256.png 256w, /owl-512.png 512w"
      }
      sizes={hero ? HERO_SIZES : MARK_SIZES}
      alt="Know It Owl"
      width={size}
      height={size}
    />
  );
}
