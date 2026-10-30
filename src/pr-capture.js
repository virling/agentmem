import fs from "node:fs";
import { parseItems } from "./capture.js";
import { TYPES } from "./store.js";

const MAX_DISCUSSION_CHARS = 60000;

async function github(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function fetchPullRequest(repo, number, token) {
  const [pr, comments, reviewComments, reviews, files] = await Promise.all([
    github(`/repos/${repo}/pulls/${number}`, token),
    github(`/repos/${repo}/issues/${number}/comments?per_page=100`, token),
    github(`/repos/${repo}/pulls/${number}/comments?per_page=100`, token),
    github(`/repos/${repo}/pulls/${number}/reviews?per_page=100`, token),
    github(`/repos/${repo}/pulls/${number}/files?per_page=100`, token),
  ]);
  return {
    number,
    title: pr.title,
    body: pr.body || "",
    author: pr.user?.login,
    comments: [
      ...comments.map((c) => ({ author: c.user?.login, body: c.body })),
      ...reviews.filter((r) => r.body).map((r) => ({ author: r.user?.login, body: r.body })),
      ...reviewComments.map((c) => ({ author: c.user?.login, body: `(${c.path}) ${c.body}` })),
    ],
    files: files.map((f) => f.filename),
  };
}

export function buildPrPrompt(pr, existingTitles) {
  const discussion = pr.comments.map((c) => `@${c.author}: ${c.body}`).join("\n\n").slice(-MAX_DISCUSSION_CHARS);
  return `You extract durable project memory from a merged pull request.

Return ONLY a JSON array (no prose, no code fence). Each item: {"title": string, "content": string, "type": one of ${JSON.stringify(TYPES.filter((t) => t !== "handoff"))}, "files": [repo-relative paths from the changed files, optional]}.

Keep only knowledge a future contributor or AI agent needs: decisions and why they were made, conventions agreed in review, gotchas discovered and how they were fixed. Skip anything that only describes what the diff does, anything already in the existing list, and anything secret. At most 5 items. Return [] if nothing qualifies.

Existing memories:
${existingTitles.length ? existingTitles.map((t) => `- ${t}`).join("\n") : "(none)"}

Pull request #${pr.number}: ${pr.title} (by @${pr.author})

Description:
${pr.body || "(none)"}

Changed files:
${pr.files.join("\n")}

Discussion:
${discussion || "(none)"}`;
}

export async function askClaudeApi(prompt, model) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: prompt }],
  });
  if (response.stop_reason === "refusal") throw new Error(`model declined: ${response.stop_details?.category ?? "unknown"}`);
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

export function savePrMemories(store, pr, output) {
  const changed = new Set(pr.files);
  const saved = [];
  const skipped = [];
  for (const item of parseItems(output)) {
    try {
      saved.push(
        store.write({
          title: item.title,
          content: `${item.content}\n\nSource: pull request #${pr.number}`,
          type: TYPES.includes(item.type) && item.type !== "handoff" ? item.type : "note",
          files: (item.files || []).filter((f) => changed.has(f)),
          scope: "team",
          agent: `pr-${pr.number}`,
        })
      );
    } catch (err) {
      skipped.push(`${item.title}: ${err.message}`);
    }
  }
  return { saved, skipped };
}

export async function capturePullRequest(store, { repo, number, token, model, runModel = askClaudeApi }) {
  const pr = await fetchPullRequest(repo, number, token);
  const output = await runModel(buildPrPrompt(pr, store.list().map((m) => m.title)), model);
  return savePrMemories(store, pr, output);
}

export function prFromEvent(eventPath = process.env.GITHUB_EVENT_PATH) {
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const pr = event.pull_request;
  if (!pr) throw new Error("this action runs on pull_request events");
  return { number: pr.number, merged: !!pr.merged };
}
