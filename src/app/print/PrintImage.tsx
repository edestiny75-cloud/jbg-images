/* eslint-disable @next/next/no-img-element */

/**
 * A plain `<img>`, deliberately.
 *
 * `next/image` is the right default everywhere else in this app, but not on a
 * document headed for a printer: it lazy-loads below-the-fold images, and the
 * print dialog does not wait for them, so a three-column price sheet prints its
 * first row and blank boxes for the rest. Eager, unmanaged images are what a
 * paper document needs, and `PrintToolbar` waits for them before printing.
 *
 * One component, one lint exception, one explanation — rather than the ten
 * copies of the same inline fallback the legacy tool carried.
 */
export function PrintImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return <img src={src} alt={alt} loading="eager" decoding="sync" className={className} />;
}
