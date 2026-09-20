export interface ModuleCInput {
  workflowId: string;
  items: readonly string[];
}

export interface ModuleCOutput {
  workflowId: string;
  success: true;
  processedItems: string[];
}
