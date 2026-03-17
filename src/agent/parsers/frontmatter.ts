// @ts-nocheck
import { FRONTMATTER_FIELD_ORDER } from "../shared/constants.js";

function parseScalar(rawValue) {
  const value = rawValue.trim();

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value === "null") {
    return null;
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\"/gu, '"').replace(/\\\\/gu, "\\");
  }

  return value;
}

function parseFrontmatterBlock(rawBlock) {
  const lines = rawBlock.split(/\r?\n/u);
  const data = {};
  const order = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const match = line.match(/^([A-Za-z][\w]*):(?:\s*(.*))?$/u);

    if (!match) {
      index += 1;
      continue;
    }

    const [, key, rawValue = ""] = match;
    order.push(key);

    if (!rawValue.trim()) {
      const values = [];
      let cursor = index + 1;

      while (cursor < lines.length) {
        const itemLine = lines[cursor];
        const itemMatch = itemLine.match(/^\s*-\s*(.*)$/u);

        if (!itemMatch) {
          break;
        }

        values.push(parseScalar(itemMatch[1]));
        cursor += 1;
      }

      data[key] = values;
      index = cursor;
      continue;
    }

    data[key] = parseScalar(rawValue);
    index += 1;
  }

  return { data, order };
}

function formatScalar(key, value) {
  if (typeof value === "boolean") {
    return String(value);
  }

  if (value === null) {
    return "null";
  }

  const normalizedValue = String(value);

  if (
    key.endsWith("Datetime") &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(normalizedValue)
  ) {
    return normalizedValue;
  }

  return `"${normalizedValue.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"')}"`;
}

export function parseMarkdownDocument(source) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u);

  if (!match) {
    return {
      hasFrontmatter: false,
      data: {},
      order: [],
      body: source,
      newline,
    };
  }

  const [, rawFrontmatter] = match;
  const body = source.slice(match[0].length).replace(/^\r?\n/u, "");
  const parsed = parseFrontmatterBlock(rawFrontmatter);

  return {
    hasFrontmatter: true,
    data: parsed.data,
    order: parsed.order,
    body,
    newline,
  };
}

export function serializeFrontmatter(data, order = [], newline = "\n") {
  const orderedKeys = [];

  for (const key of FRONTMATTER_FIELD_ORDER) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      orderedKeys.push(key);
    }
  }

  for (const key of order) {
    if (
      Object.prototype.hasOwnProperty.call(data, key) &&
      !orderedKeys.includes(key)
    ) {
      orderedKeys.push(key);
    }
  }

  for (const key of Object.keys(data)) {
    if (!orderedKeys.includes(key)) {
      orderedKeys.push(key);
    }
  }

  return orderedKeys
    .map(key => {
      const value = data[key];

      if (Array.isArray(value)) {
        if (value.length === 0) {
          return `${key}: []`;
        }

        const items = value.map(item => `  - ${formatScalar(key, item)}`);
        return `${key}:${newline}${items.join(newline)}`;
      }

      return `${key}: ${formatScalar(key, value)}`;
    })
    .join(newline);
}

export function stringifyMarkdownDocument(document) {
  const newline = document.newline ?? "\n";
  const frontmatter = serializeFrontmatter(
    document.data,
    document.order,
    newline
  );
  const body = document.body.replace(/^\r?\n/u, "");

  if (!body) {
    return `---${newline}${frontmatter}${newline}---${newline}`;
  }

  return `---${newline}${frontmatter}${newline}---${newline}${newline}${body}`;
}

export function parseMarkdownFile(source) {
  const document = parseMarkdownDocument(source);
  const normalized = source.replace(/\r\n?/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/u);
  const frontmatterLineCount = match ? match[0].split("\n").length - 1 : 0;

  return {
    hasFrontmatter: document.hasFrontmatter,
    frontmatter: document.data,
    order: document.order,
    body: document.body,
    frontmatterLineCount,
  };
}

export function composeMarkdown(frontmatter, body, order = []) {
  return stringifyMarkdownDocument({
    hasFrontmatter: true,
    data: frontmatter,
    order,
    body,
    newline: "\n",
  });
}
