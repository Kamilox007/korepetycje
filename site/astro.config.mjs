import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export default defineConfig({
  site: 'https://kamilkrzywon.pl',
  integrations: [sitemap()],
  markdown: {
    // Astro 7 renderuje Markdown domyślnie procesorem satteri() (Rust).
    // Przyjmuje on mdastPlugins/hastPlugins i NIE uruchamia wtyczek
    // remark/rehype — KaTeX wymaga jawnego przejścia na pipeline unified.
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex],
    }),
    shikiConfig: { theme: 'github-light', wrap: true },
  },
});
