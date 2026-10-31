import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TYPES = ["decision", "convention", "gotcha", "todo", "note", "handoff"];
const HANDOFF_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const GUARDS = ["warn", "block"];
export const SCOPES = ["local", "team"];
const LIST_FIELDS = ["files", "tags", "hashes"];
const TEAM_DIR = ".agentmem";
export const ORG_FILE = "org.json";
const UNUSED_AFTER_DAYS = 14;

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /\bnpm_[A-Za-z0-9]{30,}/,
  /xox[abprs]-[A-Za-z0-9-]{10,}/,
  /AIza[0-9A-Za-z_-]{35}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

export const defaultHome = () => process.env.AGENTMEM_HOME || path.join(os.homedir(), ".agentmem");

export const normalizeRemote = (url) => url.replace(/\.git$/, "").replace(/^git@([^:]+):/, "https://$1/");

export const ownerPrefix = (source) => source.slice(0, source.lastIndexOf("/") + 1);

export function orgRepos(home) {
  const file = path.join(home, ORG_FILE);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}

export function projectKey(cwd) {
  const remote = git(cwd, ["remote", "get-url", "origin"]);
  const root = git(cwd, ["rev-parse", "--show-toplevel"]) || path.resolve(cwd);
  const source = remote ? normalizeRemote(remote) : root;
  const name = path.basename(root);
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  return { id: `${name}-${hash}`, name, source, root };
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "memory";
}

function toList(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : String(value).split(",")).map((v) => String(v).trim()).filter(Boolean);
}

function words(text) {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
}

function overlap(a, b) {
  const shared = [...a].filter((w) => b.has(w)).length;
  return shared / (new Set([...a, ...b]).size || 1);
}

const isGlob = (p) => /[*?]/.test(p);

export function globToRegex(pattern) {
  const re = pattern
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) =>
      part === "**/" ? "(?:.*/)?" : part === "**" ? ".*" : part === "*" ? "[^/]*" : part === "?" ? "[^/]" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    )
    .join("");
  return new RegExp(`^${re}$`);
}

function fileHash(file) {
  return createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 12);
}

function parse(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {};
  if (match) {
    for (const line of match[1].split("\n")) {
      const i = line.indexOf(":");
      if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  for (const key of LIST_FIELDS) meta[key] = toList(meta[key]);
  meta.pinned = meta.pinned === "true";
  return { meta, body: (match ? match[2] : raw).trim() };
}

function serialize(meta, body) {
  const lines = ["title", "type", "agent", "date", "updated", "pinned", "guard", ...LIST_FIELDS]
    .filter((key) => (Array.isArray(meta[key]) ? meta[key].length : meta[key]))
    .map((key) => `${key}: ${Array.isArray(meta[key]) ? meta[key].join(", ") : String(meta[key]).replace(/\n/g, " ")}`);
  return `---\n${lines.join("\n")}\n---\n\n${body.trim()}\n`;
}

export class Store {
  constructor(cwd, home = defaultHome()) {
    this.project = projectKey(cwd);
    this.dir = path.join(home, this.project.id);
    this.teamDir = path.join(this.project.root, TEAM_DIR);
    this.orgDirs = orgRepos(home)
      .filter((r) => this.project.source.startsWith(ownerPrefix(r.source)))
      .map((r) => path.join(r.dir, TEAM_DIR));
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(
      path.join(this.dir, "project.json"),
      JSON.stringify({ name: this.project.name, source: this.project.source, root: this.project.root }, null, 2)
    );
  }

  dirFor(scope) {
    if (!SCOPES.includes(scope)) throw new Error(`scope must be one of: ${SCOPES.join(", ")}`);
    return scope === "team" ? this.teamDir : this.dir;
  }

  sources() {
    return [...SCOPES.map((scope) => [scope, this.dirFor(scope)]), ...this.orgDirs.map((dir) => ["org", dir])];
  }

  locate(id, { writable = false } = {}) {
    for (const [scope, dir] of this.sources()) {
      const file = path.join(dir, `${path.basename(id)}.md`);
      if (!fs.existsSync(file)) continue;
      if (writable && scope === "org") throw new Error(`${id} is an org memory, change it in the org memory repo`);
      return { file, scope };
    }
    throw new Error(`memory not found: ${id}`);
  }

  checkSecrets(...texts) {
    const text = texts.filter(Boolean).join("\n");
    if (SECRET_PATTERNS.some((re) => re.test(text))) throw new Error("refused: content looks like it contains a secret");
  }

  similar(title, exceptId) {
    const a = words(title);
    if (!a.size) return null;
    return this.list().find((m) => m.id !== exceptId && overlap(a, words(m.title || "")) >= 0.6) || null;
  }

  related({ title = "", content = "", files = [] }, exceptId) {
    const a = words(`${title} ${content}`);
    const fileSet = new Set(toList(files));
    return this.list().filter(
      (m) => m.id !== exceptId && (m.files.some((f) => fileSet.has(f)) || overlap(a, words(`${m.title} ${m.body}`)) >= 0.25)
    );
  }

  hashes(files) {
    return files
      .filter((f) => !isGlob(f) && fs.existsSync(path.resolve(this.project.root, f)))
      .map((f) => `${f}@${fileHash(path.resolve(this.project.root, f))}`);
  }

  validate({ type, guard }) {
    if (type !== undefined && !TYPES.includes(type)) throw new Error(`type must be one of: ${TYPES.join(", ")}`);
    if (guard && !GUARDS.includes(guard)) throw new Error(`guard must be one of: ${GUARDS.join(", ")}`);
  }

  write({ title, content, type = "note", agent = "unknown", files, tags, pinned = false, guard, scope = "local", force = false }) {
    if (!title || !content) throw new Error("title and content are required");
    this.validate({ type, guard });
    const dir = this.dirFor(scope);
    this.checkSecrets(title, content);
    if (type === "handoff") for (const old of this.list().filter((m) => m.type === "handoff" && m.scope === scope)) this.delete(old.id);
    const dup = force || type === "handoff" ? null : this.similar(title);
    if (dup) throw new Error(`similar memory exists: ${dup.id} "${dup.title}". Use memory_update, or pass force: true`);
    fs.mkdirSync(dir, { recursive: true });
    const date = new Date().toLocaleDateString("sv");
    let id = `${date}-${slugify(title)}`;
    for (let n = 2; SCOPES.some((s) => fs.existsSync(path.join(this.dirFor(s), `${id}.md`))); n++) id = `${date}-${slugify(title)}-${n}`;
    const fileList = toList(files);
    const meta = { title, type, agent, date, pinned, guard, files: fileList, tags: toList(tags), hashes: this.hashes(fileList) };
    fs.writeFileSync(path.join(dir, `${id}.md`), serialize(meta, content));
    return id;
  }

  update(id, fields) {
    const { file } = this.locate(id, { writable: true });
    const { meta, body } = parse(fs.readFileSync(file, "utf8"));
    this.validate(fields);
    this.checkSecrets(fields.title, fields.content);
    for (const key of ["title", "type", "pinned", "guard"]) if (fields[key] !== undefined) meta[key] = fields[key];
    for (const key of ["files", "tags"]) if (fields[key] !== undefined) meta[key] = toList(fields[key]);
    meta.hashes = this.hashes(meta.files);
    meta.updated = new Date().toLocaleDateString("sv");
    fs.writeFileSync(file, serialize(meta, fields.content ?? body));
    return id;
  }

  promote(id) {
    const { file, scope } = this.locate(id, { writable: true });
    if (scope === "team") throw new Error(`${id} is already a team memory`);
    const { meta, body } = parse(fs.readFileSync(file, "utf8"));
    this.checkSecrets(meta.title, body);
    fs.mkdirSync(this.teamDir, { recursive: true });
    fs.renameSync(file, path.join(this.teamDir, path.basename(file)));
    return id;
  }

  list() {
    return this.sources().flatMap(([scope, dir]) => {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".md") && f !== "README.md")
        .map((f) => {
          const { meta, body } = parse(fs.readFileSync(path.join(dir, f), "utf8"));
          const exact = meta.files.filter((p) => !isGlob(p));
          const stale = exact.filter((p) => !fs.existsSync(path.resolve(this.project.root, p)));
          const recorded = Object.fromEntries(meta.hashes.map((h) => [h.slice(0, h.lastIndexOf("@")), h.slice(h.lastIndexOf("@") + 1)]));
          const changed = exact.filter(
            (p) => recorded[p] && !stale.includes(p) && recorded[p] !== fileHash(path.resolve(this.project.root, p))
          );
          const mtime = fs.statSync(path.join(dir, f)).mtimeMs;
          return { id: f.slice(0, -3), scope, ...meta, body, stale, changed, mtime };
        });
    }).sort((a, b) => a.id.localeCompare(b.id));
  }

  latestHandoff() {
    return (
      this.list()
        .filter((m) => m.type === "handoff" && Date.now() - m.mtime < HANDOFF_MAX_AGE_MS)
        .sort((a, b) => b.mtime - a.mtime)[0] || null
    );
  }

  read(id) {
    return fs.readFileSync(this.locate(id).file, "utf8");
  }

  search(query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.list()
      .map((m) => {
        const text = `${m.title} ${m.type} ${m.scope} ${m.tags.join(" ")} ${m.files.join(" ")} ${m.body}`.toLowerCase();
        return { m, score: terms.filter((t) => text.includes(t)).length };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.m);
  }

  relative(filePath) {
    const abs = path.resolve(this.project.root, filePath);
    const real = (p) => (fs.existsSync(p) ? fs.realpathSync(p) : path.join(real(path.dirname(p)), path.basename(p)));
    return path.relative(real(this.project.root), real(abs)).split(path.sep).join("/");
  }

  forFile(filePath) {
    const rel = this.relative(filePath);
    return this.list().filter((m) => m.files.some((f) => (isGlob(f) ? globToRegex(f).test(rel) : path.normalize(f) === path.normalize(rel))));
  }

  guardsFor(filePath) {
    return this.forFile(filePath).filter((m) => m.guard);
  }

  delete(id) {
    fs.unlinkSync(this.locate(id, { writable: true }).file);
  }

  usage() {
    const file = path.join(this.dir, "usage.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { since: new Date().toLocaleDateString("sv"), items: {} };
  }

  touch(ids) {
    ids = ids.filter(Boolean);
    if (!ids.length) return;
    const usage = this.usage();
    const now = new Date().toLocaleString("sv").slice(0, 16);
    for (const id of ids) usage.items[id] = { count: (usage.items[id]?.count || 0) + 1, last: now };
    fs.writeFileSync(path.join(this.dir, "usage.json"), JSON.stringify(usage, null, 2));
  }

  stats(now = new Date()) {
    const usage = this.usage();
    const cutoff = new Date(now - UNUSED_AFTER_DAYS * 24 * 60 * 60 * 1000).toLocaleDateString("sv");
    return this.list()
      .map((m) => {
        const used = usage.items[m.id];
        const since = [m.date, usage.since].filter(Boolean).sort().pop();
        return { ...m, uses: used?.count || 0, last: used?.last, unused: !used && since <= cutoff };
      })
      .sort((a, b) => b.uses - a.uses);
  }
}

export function summary(m) {
  const flags = [
    m.scope !== "local" && m.scope,
    m.pinned && "pinned",
    m.guard && `guard: ${m.guard}`,
    m.stale?.length && `stale: ${m.stale.join(", ")} missing`,
    m.changed?.length && `changed since written: ${m.changed.join(", ")}`,
  ].filter(Boolean);
  return `- ${m.id} [${m.type}] ${m.title}${flags.length ? ` (${flags.join("; ")})` : ""}`;
}
