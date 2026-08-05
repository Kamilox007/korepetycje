import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Astro 6 usunęło stare (legacy) content collections — kolekcje muszą teraz
// deklarować loader. Schemat waha się tak samo jak model Pydantic:
// błąd we frontmatterze wywala build, a nie produkcję.

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    opis: z.string(),
    data: z.coerce.date(),
    tagi: z.array(z.string()).default([]),
    szkic: z.boolean().default(false),
  }),
});

const projekty = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projekty' }),
  schema: z.object({
    title: z.string(),
    opis: z.string(),
    stack: z.array(z.string()).default([]),
    repo: z.string().url().optional(),
    demo: z.string().url().optional(),
    kolejnosc: z.number().default(99),
    szkic: z.boolean().default(false),
  }),
});

export const collections = { blog, projekty };
