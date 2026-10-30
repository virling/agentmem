import fs from "node:fs";

const { version } = JSON.parse(fs.readFileSync("package.json", "utf8"));
for (const file of [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"]) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data.version) data.version = version;
  for (const plugin of data.plugins || []) plugin.version = version;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}
