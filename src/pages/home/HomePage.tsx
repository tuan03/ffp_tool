import { useState } from "react";

import { Button } from "../../shared/components/Button";
import { PageHeader } from "../../shared/components/PageHeader";
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
      <PageHeader title="Workflow demo" description="Chạy quy trình mẫu để kiểm tra kết nối giữa các module." />
      <Button
        className="mt-6"
        variant="primary"
        onClick={() => void handleRunWorkflow()}
      >
        Chạy quy trình mẫu
      </Button>
      {result === null ? null : (
        <pre className="mt-6 overflow-x-auto rounded-lg bg-white p-4 text-left text-xs leading-6 text-blue-700">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </>
  );
}
