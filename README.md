# RepoScope: JS/TS Repository Intelligence

**Paste any public GitHub repo link and understand the codebase in seconds.**

RepoScope clones a repository, analyzes it with a real code parser (AST), and shows its **architecture, dependencies, change impact, and security risks**. An LLM is used only to *explain* the facts the analyzer found, never to invent findings.

🔗 **Live demo:** [https://reposcope-9jr8.onrender.com](https://reposcope-9jr8.onrender.com/)

> Hosted on Render's free tier, so the first load may take ~30 seconds to wake up.


## Features

| **Overview** | File tree plus facts about each file (imports, exports, functions, components, routes) |
| **Architecture** | Diagram of frontend, backend, and how they connect |
| **Dependencies** | Import graph, npm packages, unused packages, most-imported files |
| **Impact** | Which files are affected if you change a given file (none / low / medium / high) |
| **Security** | Hardcoded secrets, injection, XSS, insecure cookies and CORS, risky CI workflows, known vulnerable packages |
| **AI explanations** | Plain-language explanations of the findings, powered by Groq and Google Gemini |
| **Hackathon Mode** | Add several repositories, get a scorecard for each, and generate judge-style questions to compare projects |



## How it works

1. You paste a GitHub URL.
2. The backend does a shallow clone (`--depth 1`) into a temp folder.
3. A **Babel AST parser** extracts imports, exports, functions, components, routes, and API calls.
4. Separate engines build the **dependency graph**, **architecture map**, and **impact analysis** (BFS over the graph).
5. The **security scanner** checks the code for risky patterns, and package versions are checked against the **OSV.dev** vulnerability database.
6. The **LLM (Groq / Google Gemini)** explains the findings in plain language.
7. Results are sent to the React dashboard and the temporary clone is deleted. Nothing is stored, so no database is needed.

**Design principle:** the analyzer finds the facts, and the LLM only explains them. Every finding shows its file and line as evidence, and secrets are always masked in the output.

---

## Tech stack

- **Frontend:** React, Vite, SVG
- **Backend:** Node.js, Express
- **Code analysis:** Babel parser (AST)
- **Security data:** OSV.dev API
- **LLMs:** Groq API, Google Gemini API
- **Deployment:** Render

---

## Run locally

```bash
# 1. Clone
git clone https://github.com/shreyachordiya/reposcope-.git
cd reposcope-

# 2. Backend
cd backend
npm install
node server.js

# 3. Frontend (new terminal, from the project root)
npm install
npm run dev
```

### Environment variables

Create a `backend/.env` file (never commit this file):

```
GROQ_API_KEY=your_groq_key
GEMINI_API_KEY=your_google_key
```

---

## Limitations

- Built for **JavaScript / TypeScript** projects (React, Node, Express).
- Security scanning is pattern-based. "No findings" does **not** mean "secure", and some findings may be false positives (each shows a confidence level).
- Static analysis only: the code is read, never executed.
- Alias imports (e.g. `@/components`) may not be fully resolved.

---

## Author

**Shreya Chordiya**

- GitHub: [shreyachordiya](https://github.com/shreyachordiya)
