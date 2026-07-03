import { visit } from "unist-util-visit";

const alerts = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

const markerPattern = /^\[!(note|tip|important|warning|caution)\][\t ]*/i;

function normalizeClassList(value) {
  if (!value) return [];
  return Array.isArray(value)
    ? value
    : String(value).split(/\s+/).filter(Boolean);
}

function isWhitespaceText(node) {
  return node?.type === "text" && /^\s*$/.test(node.value);
}

function isBreak(node) {
  return node?.type === "element" && node.tagName === "br";
}

function removeLeadingAlertMarker(paragraph) {
  const firstChild = paragraph.children?.[0];
  if (firstChild?.type !== "text") return null;

  const match = firstChild.value.match(markerPattern);
  if (!match) return null;

  const kind = match[1].toLowerCase();
  firstChild.value = firstChild.value
    .slice(match[0].length)
    .replace(/^\r?\n/, "")
    .replace(/^[\t ]+/, "");

  if (firstChild.value === "") {
    paragraph.children.shift();
  }

  while (
    isWhitespaceText(paragraph.children?.[0]) ||
    isBreak(paragraph.children?.[0])
  ) {
    paragraph.children.shift();
  }

  return kind;
}

function isEmptyElement(node) {
  return (
    node?.type === "element" &&
    (!node.children || node.children.every(isWhitespaceText))
  );
}

export default function rehypeAlerts() {
  return tree => {
    visit(tree, "element", node => {
      if (node.tagName !== "blockquote") return;

      const firstParagraphIndex = node.children?.findIndex(
        child => child.type === "element" && child.tagName === "p"
      );
      if (firstParagraphIndex === undefined || firstParagraphIndex < 0) return;

      const firstParagraph = node.children[firstParagraphIndex];
      const kind = removeLeadingAlertMarker(firstParagraph);
      if (!kind) return;

      const title = alerts[kind];
      const existingClasses = normalizeClassList(
        node.properties?.className ?? node.properties?.class
      );

      node.tagName = "div";
      node.properties = {
        ...(node.properties || {}),
        className: [
          ...new Set([
            ...existingClasses,
            "markdown-alert",
            `markdown-alert-${kind}`,
          ]),
        ],
        dataAlert: kind,
      };

      const children = [...node.children];
      if (isEmptyElement(firstParagraph)) {
        children.splice(firstParagraphIndex, 1);
      }

      node.children = [
        {
          type: "element",
          tagName: "p",
          properties: { className: ["markdown-alert-title"] },
          children: [{ type: "text", value: title }],
        },
        ...children,
      ];
    });
  };
}
