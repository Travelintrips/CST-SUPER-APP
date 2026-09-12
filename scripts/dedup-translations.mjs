/**
 * Deduplicates object literal keys in a TypeScript file.
 * For each key that appears more than once at the same object depth,
 * keeps the LAST occurrence (which is what JavaScript uses at runtime)
 * and removes all earlier occurrences.
 *
 * Usage: node scripts/dedup-translations.mjs <path-to-file>
 */
import ts from "typescript";
import fs from "fs";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node dedup-translations.mjs <path>");
  process.exit(1);
}

const source = fs.readFileSync(filePath, "utf8");
const sourceFile = ts.createSourceFile(
  filePath,
  source,
  ts.ScriptTarget.Latest,
  /* setParentNodes */ true
);

// Ranges to delete: [start, end) offsets into `source`
const removals = [];

function visitNode(node) {
  if (ts.isObjectLiteralExpression(node)) {
    // Group property assignments by key name at THIS object level only
    const propsByKey = new Map(); // keyName -> PropertyAssignment[]

    for (const prop of node.properties) {
      if (
        ts.isPropertyAssignment(prop) ||
        ts.isShorthandPropertyAssignment(prop)
      ) {
        const name = prop.name;
        const keyName = ts.isStringLiteral(name) ? name.text : name.getText(sourceFile);

        if (!propsByKey.has(keyName)) propsByKey.set(keyName, []);
        propsByKey.get(keyName).push(prop);
      }
    }

    // Mark all but the last occurrence of each duplicated key for removal
    for (const [, props] of propsByKey) {
      if (props.length < 2) continue;

      for (let i = 0; i < props.length - 1; i++) {
        const prop = props[i];
        // getFullStart() includes leading whitespace/comments
        let start = prop.getFullStart();
        let end = prop.getEnd();

        // Consume trailing comma (and optional space) so we don't leave ", ,"
        while (end < source.length && (source[end] === "," || source[end] === " ")) {
          end++;
        }

        removals.push({ start, end });
      }
    }
  }

  ts.forEachChild(node, visitNode);
}

visitNode(sourceFile);

if (removals.length === 0) {
  console.log("No duplicate keys found.");
  process.exit(0);
}

// Sort removals from end to beginning so index positions don't shift during splice
removals.sort((a, b) => b.start - a.start);

// Remove any overlapping ranges (shouldn't happen, but be safe)
const clean = [removals[0]];
for (let i = 1; i < removals.length; i++) {
  const prev = clean[clean.length - 1];
  const cur = removals[i];
  if (cur.end <= prev.start) {
    clean.push(cur);
  }
  // else: overlapping — skip the inner one
}

let result = source;
for (const { start, end } of clean) {
  result = result.slice(0, start) + result.slice(end);
}

fs.writeFileSync(filePath, result, "utf8");
console.log(
  `✓ Removed ${clean.length} duplicate propert${clean.length === 1 ? "y" : "ies"} from ${filePath}`
);
