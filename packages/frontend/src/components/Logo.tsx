/**
 * The owl.
 *
 * The artwork already contains the "KNOW IT OWL" wordmark, so nothing that
 * renders this should add a text heading beside it — that reads as the name
 * twice.
 *
 * Two sources rather than one: the hero wants enough pixels to show the glasses
 * and the lightbulb on a 2x phone, and the header mark does not — loading a
 * 320KB image to draw it 40px wide would be silly. The hero's box is sized in
 * CSS so it can scale with the viewport; `size` here is the intrinsic hint that
 * stops the page reflowing once the image lands.
 */
import "./Logo.css";

export interface LogoProps {
  size?: number;
  /** The hero treatment on the Join screen, versus the small header mark. */
  variant?: "hero" | "mark";
}

const SOURCE: Record<NonNullable<LogoProps["variant"]>, string> = {
  hero: "/owl-512.png",
  mark: "/owl-256.png",
};

export function Logo({ size = 128, variant = "mark" }: LogoProps) {
  return (
    <img
      className={`kio-logo kio-logo--${variant}`}
      src={SOURCE[variant]}
      alt="Know It Owl"
      width={size}
      height={size}
    />
  );
}
