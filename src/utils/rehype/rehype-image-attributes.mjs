import { visit } from "unist-util-visit";

/**
 * Rehype plugin: add lazy loading, decoding optimization, and
 * Tailwind utility classes to all Markdown images.
 */
export default function rehypeImageAttributes() {
  return tree => {
    visit(tree, "element", node => {
      if (node.tagName === "img") {
        node.properties = node.properties || {};

        // Lazy loading & decoding optimization
        node.properties.loading = "lazy";
        node.properties.decoding = "async";

        // Unified style classes (Tailwind)
        const existing =
          node.properties.className ?? node.properties.class ?? [];
        const arr = Array.isArray(existing)
          ? existing
          : String(existing).split(/\s+/).filter(Boolean);
        node.properties.className = [
          ...new Set([...arr, "mx-auto", "rounded-lg", "shadow"]),
        ];
      }
    });
  };
}
