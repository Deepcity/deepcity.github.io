import { defineCollection, z } from 'astro:content';

const blogCollection = defineCollection({
  schema: z.object({
    title: z.string(),
    pubDate: z.string(),
    summary: z.string().optional(),
  }),
});

export const collections = {
  blog: blogCollection,
};