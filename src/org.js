import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ORG_FILE, normalizeRemote, orgRepos, ownerPrefix } from "./store.js";

function save(home, repos) {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, ORG_FILE), JSON.stringify(repos, null, 2));
}

export function addOrg(home, url) {
  const source = normalizeRemote(url);
  const repos = orgRepos(home);
  if (repos.some((r) => r.source === source)) throw new Error(`already added: ${source}`);
  const dir = path.join(home, "_org", source.split("/").slice(-2).join("-"));
  execFileSync("git", ["clone", "--quiet", "--depth", "1", url, dir], { stdio: ["ignore", "ignore", "inherit"] });
  repos.push({ url, source, dir });
  save(home, repos);
  return { source, dir, prefix: ownerPrefix(source) };
}

export function pullOrgs(home) {
  const repos = orgRepos(home);
  for (const r of repos) execFileSync("git", ["-C", r.dir, "pull", "--quiet", "--ff-only"], { stdio: ["ignore", "ignore", "inherit"] });
  return repos;
}

export function removeOrg(home, url) {
  const source = normalizeRemote(url);
  const repos = orgRepos(home);
  const found = repos.find((r) => r.source === source);
  if (!found) throw new Error(`not an org memory repo: ${source}`);
  fs.rmSync(found.dir, { recursive: true, force: true });
  save(home, repos.filter((r) => r !== found));
  return source;
}
