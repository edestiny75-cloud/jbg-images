import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'JBG Fulfillment',
  description: 'Catalog, print queue, box planning and packing for Jelly Bean Genius.',
};

export const viewport: Viewport = {
  themeColor: '#0b0c0f',
  width: 'device-width',
  initialScale: 1,
  // The packer screen is used on an iPad; pinch-zoom stays available.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
