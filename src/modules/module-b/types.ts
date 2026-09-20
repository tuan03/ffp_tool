export interface ModuleBInput {
  workflowId: string;
  items: readonly string[];
}

export interface ModuleBOutput {
  workflowId: string;
  success: true;
  itemCount: number;
}
