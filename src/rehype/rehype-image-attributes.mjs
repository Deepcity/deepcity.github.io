import { visit } from 'unist-util-visit';

/**
 * 给所有 Markdown 图片统一加属性
 */
export default function rehypeImageAttributes() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName === 'img') {
        node.properties = node.properties || {};

        // 懒加载 & 解码优化
        node.properties.loading = 'lazy';
        node.properties.decoding = 'async';

        // 统一样式 class
        const existing = node.properties.className ?? node.properties.class ?? [];
        const arr = Array.isArray(existing)
          ? existing
          : String(existing).split(/\s+/).filter(Boolean);
        node.properties.className = [...new Set([...arr, 'mx-auto', 'rounded-lg', 'shadow'])];

        // 👉 如果你想自定义响应式，可以在这里构造 srcset
        // 例如给 CDN URL 添加参数（假设 ?w=640 可以控制宽度）
        node.properties.srcset = `${node.properties.src}?w=640 640w, ${node.properties.src}?w=1280 1280w`;
        node.properties.sizes = "(max-width: 768px) 100vw, 768px";
      }
    });
  };
}
