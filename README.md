# Resumix

Resume tailoring workbench: define every experience, project, bullet and skill once,
then compose a custom LaTeX resume per company by picking and ordering that content.

See [docs/STATE.md](docs/STATE.md) for current project status and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

## Quick start

```bash
cp .env.example .env
docker compose up -d db latex
npm install
npm run db:migrate
npm run db:seed
npm run dev
```
