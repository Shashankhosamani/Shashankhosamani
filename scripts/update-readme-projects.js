#!/usr/bin/env node
// Regenerates the "Things I've built" table in README.md from live pinned
// (falling back to most-recently-pushed) repos. Run by
// .github/workflows/update-projects.yml — do not run against untrusted input.

const fs = require("fs");
const path = require("path");

const USERNAME = "Shashankhosamani";
const TOKEN = process.env.GITHUB_TOKEN;
const README_PATH = path.join(__dirname, "..", "README.md");
const START = "<!-- PROJECTS:START -->";
const END = "<!-- PROJECTS:END -->";

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`GraphQL request failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

const REPO_FIELDS = `
  name
  url
  description
  primaryLanguage { name }
  languages(first: 3, orderBy: { field: SIZE, direction: DESC }) { nodes { name } }
`;

async function fetchPinnedRepos() {
  const data = await graphql(
    `
    query($login: String!) {
      user(login: $login) {
        pinnedItems(first: 6, types: REPOSITORY) {
          nodes { ... on Repository { ${REPO_FIELDS} } }
        }
      }
    }
  `,
    { login: USERNAME },
  );
  return data.user.pinnedItems.nodes;
}

async function fetchRecentRepos() {
  const data = await graphql(
    `
    query($login: String!) {
      user(login: $login) {
        repositories(
          first: 4
          ownerAffiliations: OWNER
          isFork: false
          privacy: PUBLIC
          orderBy: { field: PUSHED_AT, direction: DESC }
        ) {
          nodes { ${REPO_FIELDS} }
        }
      }
    }
  `,
    { login: USERNAME },
  );
  return data.user.repositories.nodes;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderCard(repo) {
  const desc = escapeHtml(repo.description || "No description yet.");
  const langs = repo.languages?.nodes?.length
    ? repo.languages.nodes.map((l) => l.name)
    : repo.primaryLanguage
      ? [repo.primaryLanguage.name]
      : [];
  const tags = langs.length
    ? langs.map((l) => `<code>${escapeHtml(l)}</code>`).join(" ")
    : "<code>—</code>";
  return `    <td width="50%" valign="top">
      <h4><a href="${repo.url}">${escapeHtml(repo.name)}</a></h4>
      <p>${desc}</p>
      <p>${tags}</p>
    </td>`;
}

function renderTable(repos) {
  const rows = [];
  for (let i = 0; i < repos.length; i += 2) {
    const cells = repos
      .slice(i, i + 2)
      .map(renderCard)
      .join("\n");
    rows.push(`  <tr>\n${cells}\n  </tr>`);
  }
  return `<table>\n${rows.join("\n")}\n</table>`;
}

async function main() {
  if (!TOKEN) throw new Error("GITHUB_TOKEN is required");

  let repos = await fetchPinnedRepos();
  if (!repos || repos.length === 0) {
    console.log("No pinned repos, falling back to recently pushed repos.");
    repos = await fetchRecentRepos();
  }
  if (!repos || repos.length === 0) {
    console.log("No repos found — leaving README.md untouched.");
    return;
  }

  const table = renderTable(repos);
  const readme = fs.readFileSync(README_PATH, "utf8");
  const startIdx = readme.indexOf(START);
  const endIdx = readme.indexOf(END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`README.md is missing the ${START} / ${END} markers`);
  }

  const before = readme.slice(0, startIdx + START.length);
  const after = readme.slice(endIdx);
  const next = `${before}\n${table}\n${after}`;

  if (next === readme) {
    console.log("Project cards are already up to date.");
    return;
  }
  fs.writeFileSync(README_PATH, next);
  console.log(`README.md updated with ${repos.length} project card(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
