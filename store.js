import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TYPES = ["decision", "convention", "gotcha", "todo", "note"];
const LIST_FIELDS = ["files", "tags"];

const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
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

export function projectKey(cwd) {
  const remote = git(cwd, ["remote", "get-url", "origin"]);
  const root = git(cwd, ["rev-parse", "--show-toplevel"]) || path.resolve(cwd);
  const source = remote ? remote.replace(/\.git$/, "").replace(/^git@([^:]+):/, "https://$1/") : root;
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
  const lines = ["title", "type", "agent", "date", "updated", "pinned", ...LIST_FIELDS]
    .filter((key) => (Array.isArray(meta[key]) ? meta[key].length : meta[key]))
    .map((key) => `${key}: ${Array.isArray(meta[key]) ? meta[key].join(", ") : String(meta[key]).replace(/\n/g, " ")}`);
  return `---\n${lines.join("\n")}\n---\n\n${body.trim()}\n`;
}

export class Store {
  constructor(cwd, home = process.env.AGENTMEM_HOME || path.join(os.homedir(), ".agentmem")) {
    this.project = projectKey(cwd);
    this.dir = path.join(home, this.project.id);
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(
      path.join(this.dir, "project.json"),
      JSON.stringify({ name: this.project.name, source: this.project.source, root: this.project.root }, null, 2)
    );
  }

  file(id) {
    const file = path.join(this.dir, `${path.basename(id)}.md`);
    if (!fs.existsSync(file)) throw new Error(`memory not found: ${id}`);
    return file;
  }

  checkSecrets(...texts) {
    const text = texts.filter(Boolean).join("\n");
    if (SECRET_PATTERNS.some((re) => re.test(text))) throw new Error("refused: content looks like it contains a secret");
  }

  similar(title, exceptId) {
    const a = words(title);
    if (!a.size) return null;
    return (
      this.list().find((m) => {
        if (m.id === exceptId) return false;
        const b = words(m.title || "");
        const shared = [...a].filter((w) => b.has(w)).length;
        return shared / new Set([...a, ...b]).size >= 0.6;
      }) || null
    );
  }

  write({ title, content, type = "note", agent = "unknown", files, tags, pinned = false, force = false }) {
    if (!title || !content) throw new Error("title and content are required");
    if (!TYPES.includes(type)) throw new Error(`type must be one of: ${TYPES.join(", ")}`);
    this.checkSecrets(title, content);
    const dup = force ? null : this.similar(title);
    if (dup) throw new Error(`similar memory exists: ${dup.id} "${dup.title}". Use memory_update, or pass force: true`);
    const date = new Date().toLocaleDateString("sv");
    let id = `${date}-${slugify(title)}`;
    for (let n = 2; fs.existsSync(path.join(this.dir, `${id}.md`)); n++) id = `${date}-${slugify(title)}-${n}`;
    const meta = { title, type, agent, date, pinned, files: toList(files), tags: toList(tags) };
    fs.writeFileSync(path.join(this.dir, `${id}.md`), serialize(meta, content));
    return id;
  }

  update(id, fields) {
    const file = this.file(id);
    const { meta, body } = parse(fs.readFileSync(file, "utf8"));
    if (fields.type && !TYPES.includes(fields.type)) throw new Error(`type must be one of: ${TYPES.join(", ")}`);
    this.checkSecrets(fields.title, fields.content);
    for (const key of ["title", "type", "pinned"]) if (fields[key] !== undefined) meta[key] = fields[key];
    for (const key of LIST_FIELDS) if (fields[key] !== undefined) meta[key] = toList(fields[key]);
    meta.updated = new Date().toLocaleDateString("sv");
    fs.writeFileSync(file, serialize(meta, fields.content ?? body));
    return id;
  }

  list() {
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => {
        const { meta, body } = parse(fs.readFileSync(path.join(this.dir, f), "utf8"));
        const stale = meta.files.filter((p) => !fs.existsSync(path.resolve(this.project.root, p)));
        return { id: f.slice(0, -3), ...meta, body, stale };
      });
  }

  read(id) {
    return fs.readFileSync(this.file(id), "utf8");
  }

  search(query) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return this.list()
      .map((m) => {
        const text = `${m.title} ${m.type} ${m.tags.join(" ")} ${m.files.join(" ")} ${m.body}`.toLowerCase();
        return { m, score: terms.filter((t) => text.includes(t)).length };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.m);
  }

  forFile(filePath) {
    const rel = path.relative(this.project.root, path.resolve(this.project.root, filePath));
    return this.list().filter((m) => m.files.some((f) => path.normalize(f) === rel));
  }

  delete(id) {
    fs.unlinkSync(this.file(id));
  }
}

export function summary(m) {
  const flags = [m.pinned && "pinned", m.stale?.length && `stale: ${m.stale.join(", ")} missing`].filter(Boolean);
  return `- ${m.id} [${m.type}] ${m.title}${flags.length ? ` (${flags.join("; ")})` : ""}`;
}
