import { defineCollection, z } from 'astro:content';

const blogCollection = defineCollection({
  schema: z.object({
    title: z.string(),
    date: z.date()
  }),
});

export const collections = {
  blog: blogCollection,
};