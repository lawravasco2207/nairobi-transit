import fs from 'fs';
import path from 'path';
import type { Metadata } from 'next';
import { markdownToHtml } from '@/lib/markdown';

export const metadata: Metadata = {
  title: 'Docs — Nairobi Transit',
  description: 'How the Nairobi Transit cashless matatu payment system works — for passengers, conductors, and SACCOs.',
};

export default function DocsPage() {
  const content = fs.readFileSync(
    path.join(process.cwd(), 'src/content/docs.md'),
    'utf-8',
  );

  const html = markdownToHtml(content);

  return (
    <>
      {/* Rendered markdown */}
      <article
        className="docs-prose max-w-4xl mx-auto px-4 pt-8 pb-28"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
