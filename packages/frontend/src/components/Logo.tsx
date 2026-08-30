/**
 * The owl, on every page.
 *
 * Deliberately plain: the screens are placeholders until the Stitch design
 * lands, so this is the one place the mark appears and the one place to change
 * when the real header arrives.
 */
export function Logo({ size = 128 }: { size?: number }) {
  return (
    <img
      src="/owl-256.png"
      // The wordmark is part of the image, so the alt text is the name itself.
      alt="Know It Owl"
      width={size}
      height={size}
      style={{ display: "block", margin: "0 auto", maxWidth: "100%", height: "auto" }}
    />
  );
}
