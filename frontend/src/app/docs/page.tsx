import fs from 'fs';
import path from 'path';
import type { Metadata } from 'next';
import { markdownToHtml } from '@/lib/markdown';

export const metadata: Metadata = {
  title: 'Docs — Nairobi Transit',
  description: 'Technical documentation for the Nairobi Transit cashless matatu payment system.',
};

export default function DocsPage() {
  const content = fs.readFileSync(
    path.join(process.cwd(), 'src/content/docs.md'),
    'utf-8',
  );

  const html = markdownToHtml(content);

  return (
    <>
      {/* Edit-hint banner */}
      <div className="bg-transit-green text-white px-4 py-3 border-b-2 border-transit-green-dark">
        <p className="text-xs text-white/75 font-mono">
          Edit{' '}
          <code className="bg-white/20 px-1 rounded">frontend/src/content/docs.md</code>
          {' '}to update this page
        </p>
      </div>

      {/* Rendered markdown */}
      <article
        className="docs-prose max-w-4xl mx-auto px-4 pt-8 pb-28"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
