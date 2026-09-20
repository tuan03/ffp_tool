export interface ModuleAInput {
  workflowId: string;
  items: readonly string[];
}

export interface ModuleAOutput {
  workflowId: string;
  success: true;
  normalizedItems: string[];
}
