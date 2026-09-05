import { PrintImage } from './PrintImage';

/**
 * The masthead both documents share.
 *
 * The legacy price sheet and quote each carried their own copy of this markup
 * *and* their own copy of the logo — the same 448 KB PNG pasted twice more as a
 * base64 data URI, on top of the one already in the page. It is one 19 KB file
 * in `public/` now, fetched once and cached.
 */
export function DocHead({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="doc-head">
      <PrintImage src="/logo-small.png" alt="Jelly Bean Genius" />
      <div>
        <h1>{title}</h1>
        <div className="doc-sub">{subtitle}</div>
      </div>
    </header>
  );
}
