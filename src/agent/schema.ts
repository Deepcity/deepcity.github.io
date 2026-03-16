// @ts-nocheck
import { CONTENT_SCHEMA_PATH } from "./constants.js";
import { readText } from "./fs.js";

function inferFieldType(definition) {
  if (definition.includes("z.array(z.string())")) {
    return "string[]";
  }

  if (definition.includes("z.boolean()")) {
    return "boolean";
  }

  if (definition.includes("z.date()")) {
    return "date";
  }

  if (definition.includes("image().or(z.string())")) {
    return "string|image";
  }

  return "string";
}

export async function loadContentSchemaRules() {
  const source = await readText(CONTENT_SCHEMA_PATH);
  const objectMatch = source.match(/z\.object\(\{([\s\S]*?)\n\s*\}\)/u);

  if (!objectMatch) {
    throw new Error("Cannot parse blog schema from src/content.config.ts");
  }

  const fields = {};
  const block = objectMatch[1];

  for (const line of block.split("\n")) {
    const match = line.match(/^\s*(\w+):\s*(.+?),?\s*$/u);

    if (!match) {
      continue;
    }

    const [, key, definition] = match;
    fields[key] = {
      type: inferFieldType(definition),
      required:
        !definition.includes(".optional()") &&
        !definition.includes(".default("),
      has_default: definition.includes(".default("),
      source: definition.trim(),
    };
  }

  return {
    source_path: CONTENT_SCHEMA_PATH,
    fields,
    required_fields: Object.entries(fields)
      .filter(([, definition]) => definition.required)
      .map(([key]) => key),
    optional_fields: Object.entries(fields)
      .filter(([, definition]) => !definition.required)
      .map(([key]) => key),
  };
}
