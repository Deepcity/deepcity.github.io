// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import remarkGfm from 'remark-gfm';
import rehypeImageAttributes from './src/rehype/rehype-image-attributes.mjs';

// https://astro.build/config
export default defineConfig({
	integrations: [react()],

  markdown: {
		shikiConfig: {
		wrap: true,
		},
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeImageAttributes],
  },

	
});
