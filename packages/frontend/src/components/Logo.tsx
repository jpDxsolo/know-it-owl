/**
 * The owl.
 *
 * The artwork already contains the "KNOW IT OWL" wordmark, so nothing that
 * renders this should add a text heading beside it — that reads as the name
 * twice. `size` is the rendered box; the asset is 256px so it stays crisp on a
 * 2x display up to 128.
 */
import "./Logo.css";

export interface LogoProps {
  size?: number;
  /** The hero treatment on the Join screen, versus the small header mark. */
  variant?: "hero" | "mark";
}

export function Logo({ size = 128, variant = "mark" }: LogoProps) {
  return (
    <img
      className={`kio-logo kio-logo--${variant}`}
      src="/owl-256.png"
      alt="Know It Owl"
      width={size}
      height={size}
    />
  );
}
