import { useState } from "react";

import type { WorkflowInput, WorkflowOutput } from "../../modules/orchestrator";

interface HomePageProps {
  runWorkflow(input: WorkflowInput): Promise<WorkflowOutput>;
}

export function HomePage({ runWorkflow }: HomePageProps): React.JSX.Element {
  const [result, setResult] = useState<WorkflowOutput | null>(null);

  async function handleRunWorkflow(): Promise<void> {
    const workflowResult = await runWorkflow({
      workflowId: crypto.randomUUID(),
      items: ["example input"],
    });

    setResult(workflowResult);
  }

  return (
    <>
      <h1 className="mt-5 text-4xl font-bold tracking-tight">Hello, world!</h1>
      <p className="mt-4 text-lg leading-8 text-slate-300">
        React, TypeScript, Vite, and Tailwind are ready. Business modules remain isolated
        under <code className="rounded bg-slate-800 px-1.5 py-0.5 text-sm text-cyan-300">src/modules</code>.
      </p>
      <button
        className="mt-6 rounded-lg bg-cyan-400 px-4 py-2 font-semibold text-slate-950 transition hover:bg-cyan-300"
        type="button"
        onClick={() => void handleRunWorkflow()}
      >
        Run workflow
      </button>
      {result === null ? null : (
        <pre className="mt-6 overflow-x-auto rounded-lg bg-slate-950 p-4 text-left text-xs leading-6 text-cyan-100">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </>
  );
}
