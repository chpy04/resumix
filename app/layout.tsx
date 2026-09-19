import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Resumix',
  description: 'Tailor a resume per company without re-authoring it.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
