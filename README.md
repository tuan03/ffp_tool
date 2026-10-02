# FFP Tool

## Production deployment

The root `docker-compose.yml` is the only supported production manifest. Create `.env`
from `.env.example`, configure the required secrets, and start the complete
`database`/`server`/`client` topology with:

```bash
docker compose up -d --build
```

Do not start module-specific Compose stacks in production. See
`docs/unified-deployment-and-crawler.md` for environment, reverse-proxy, persistence,
resource-limit, and backup instructions.

FFP Tool is a modular single-page application built with React, TypeScript, Vite, Tailwind CSS, and React Router.

It is one repository and one application, not a monorepo. The code is organized so a main UI developer and three module developers can work in parallel with clear ownership and minimal Git conflicts.

## Tech stack

- React 19
- TypeScript with strict type checking
- Vite 8
- Tailwind CSS 4
- React Router 7
- Node's built-in test runner via `tsx`

## Quick start

Prerequisites: Node.js 22.12 or later and npm.

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal, usually `http://localhost:5173/`. The home route `/` displays the Hello World page and can run the sample workflow.

## Review image generator (local)

The **Tạo ảnh review** menu opens `/review-images`. The page uses a scene template as Image 1 and an uploaded handbag/wallet product photo as Image 2. The original product in the scene must be removed. Review the generated image carefully—especially printed artwork and text—before approving and downloading it. This workflow does not write to Shopify.

1. Install the Bridge dependencies with `python -m pip install -r src/modules/review-image/server/requirements.txt`. Put PNG, JPEG or WebP scene templates (up to 5 MB each) in `data/review-image-templates/`. The folder is local and ignored by Git; the supplied bedroom sample is present in this workspace. Outputs are saved in `exports/review-images/`.
2. Start the complete local app with `npm run dev`. It starts the UI on `http://127.0.0.1:5173`, crawler coordinator on `8766`, and the review-image Bridge on `127.0.0.1:8770`.
3. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this checkout's `browser-extension/review-image` directory. Reload an already signed-in `chatgpt.com` tab after loading the extension.
4. In the extension popup, use `ws://127.0.0.1:8770/ws/extension`, enter the same token as `REVIEW_IMAGE_BRIDGE_TOKEN` in `.env.local`, and enable the connection. For local testing when that setting is absent, both sides use `change-this-token`; set a long random private token before regular use.
5. Open `/review-images`, upload the product photo, choose **Chỉ túi chính** or **Cả túi và ví**, adjust the prompt, then generate. You can retry with the same template or choose another. Download appears only after **Duyệt ảnh**.

The local Bridge is a separate process. If running the UI and gateway without `npm run dev`, also run `python src/modules/review-image/server/api.py`. Keep this service bound to loopback; its browser extension uses a private WebSocket token. A deployed instance needs this service started separately with the same `REVIEW_IMAGE_BRIDGE_TOKEN` as its gateway.

If the production gateway uses `GATEWAY_AUTH_TOKEN` without operator Basic authentication, enter that token in the page's **Gateway token** field. The page keeps it in memory only and uses it for both API calls and image previews/downloads. When operator Basic authentication is enabled, use that login instead.

## Run with mock data

Mock mode lets the main UI developer build independently of unfinished real module integrations.

```bash
npm run dev:mock
```

This command loads [`.env.mock`](.env.mock), which sets:

```env
VITE_APP_ENV=mock
```

| Environment | Command | Module runner |
| --- | --- | --- |
| Mock | `npm run dev:mock` | `mocks/runner.ts` |
| Development | `npm run dev` | `service.ts` |
| Production | `npm run build` | `service.ts` |

Use `.env.local` or `.env.<mode>.local` for machine-specific settings. Never put secrets in `VITE_` variables because Vite exposes them to browser code.

## Commands

```bash
npm run dev          # Start Vite in development mode
npm run dev:mock     # Start Vite using mock module runners
npm test             # Run module and orchestrator tests
npm run typecheck    # Run TypeScript without emitting files
npm run build        # Typecheck and build production assets
npm run build:mock   # Typecheck and build with mock mode
npm run preview      # Preview the latest production build
```

## Architecture

```text
src/
├── app/                 # Application composition, routes, providers, runtime wiring
├── config/              # Environment configuration
├── layouts/             # Shared route layouts
├── pages/               # Application-level pages
├── styles/              # Global Tailwind stylesheet
├── modules/
│   ├── orchestrator/    # Coordinates the workflow
│   ├── module-api/      # Module API contract, Shopify client service, mock runner, tests
│   ├── module-a/        # Business module A
│   ├── module-b/        # Business module B
│   └── module-c/        # Business module C
└── shared/              # Small cross-cutting contracts, errors, and utilities
gateway/                 # Standalone Shopify GraphQL proxy gateway (Node.js/Vite server)
```

The dependency direction is:

```text
app / pages / layouts
        ↓
   orchestrator
   ↙    ↓    ↘
module-api module-a module-b module-c
        ↓
     gateway
        ↓
      shared
```

Modules do not depend on each other. Consumers use only the module's public `index.ts`; importing a module's internal `service.ts`, `runtime.ts`, `mocks/`, or UI files is forbidden.

## Module convention

Each business module follows this structure:

```text
module-x/
├── index.ts          # Public exports
├── types.ts          # Public input/output contracts
├── service.ts        # Real development/production behavior
├── runtime.ts        # Selects real or mock runner
├── mocks/
│   ├── data.ts       # Safe representative fixtures
│   └── runner.ts     # Mock implementation
├── ui/               # Optional module-owned UI
├── routes.tsx        # Optional module-owned route objects
└── __tests__/        # Module unit tests
```

`mocks/runner.ts` and `service.ts` must implement the same public contract. The main application calls the module's public `getModuleXRunner(environment)` function and never imports mock fixtures directly.

## Workflow

`orchestrator` receives the workflow input, runs Module A, then runs Module B and C concurrently when they are independent. It aggregates the outputs and wraps failures with specific `AppError` codes such as `MODULE_A_FAILED`.

The main UI calls `runWorkflow` from `src/app/runtime/workflow.ts`. It does not call module internals directly.

## Routes

React Router is configured in `src/app/routes/AppRoutes.tsx`.

- `/` renders the Hello World page.
- `AppLayout` uses `Outlet` for nested pages.
- A future module route belongs in that module's `routes.tsx` and is exported from its public `index.ts`.
- The main owner registers public module route collections; it does not import a module page directly.

## Team workflow

Read [AGENTS.md](AGENTS.md) before working in this repository. It defines mandatory rules for ownership, imports, TypeScript, React, tests, mock data, error handling, dependencies, Git, branches, and agent handoff.

For the intended team of one leader and four developers:

1. The leader defines modules, workflow relationships, and input/output contracts.
2. Module A/B/C owners each implement and test contracts plus mock runners.
3. After the leader accepts the mock contracts, the main owner can build UI with `npm run dev:mock` while module owners implement real services in parallel.
4. Public contract changes require leader review and coordinated updates to consumers.

See [docs/development-guide.md](docs/development-guide.md) for detailed onboarding and Antigravity task templates.

## Contributing

Each task uses one focused branch:

```text
<type>/<scope>-<short-description>
```

Examples:

```text
feature/module-a-add-normalizer
feature/module-api-add-runner
feature/gateway-group-variants
feature/main-add-workflow-page
fix/module-b-handle-empty-result
```

Before handoff, run:

```bash
npm test
npm run typecheck
npm run build
```

For mock/runtime changes, also run `npm run build:mock`.
