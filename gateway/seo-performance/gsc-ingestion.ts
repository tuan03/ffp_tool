import {
  GSC_DAILY_ROW_LIMIT,
  GSC_ROW_LIMIT,
  normalizeGscRow,
  withGscStartRow,
  type GscNormalizedRow,
  type GscQueryContract,
  type GscRawSearchRow,
} from "./gsc-contracts";

export type GscSourceCoverage = "TOP_ROWS_ONLY" | "PARTIAL" | "REQUEST_COMPLETE_WITH_PROVIDER_LIMITS";

export interface GscFetchPage {
  readonly rows: readonly GscRawSearchRow[];
}

export interface GscPartitionQuality {
  readonly dataState: "final";
  readonly dataThrough: string;
  /** Pagination completed; this never means Google exposed every provider row. */
  readonly fetchComplete: true;
  readonly sourceCoverage: GscSourceCoverage;
  readonly pagesFetched: number;
  readonly rowsReceived: number;
  readonly providerRowLimitReached: boolean;
}

export interface CompletedGscPartition {
  readonly contract: GscQueryContract;
  readonly rows: readonly GscNormalizedRow[];
  readonly quality: GscPartitionQuality;
}

export interface GscPaginationLog {
  readonly startRow: number;
  readonly returnedRows: number;
}

export interface StageGscPartitionInput {
  readonly contract: GscQueryContract;
  readonly dataThrough: string;
  readonly sourceCoverage?: GscSourceCoverage;
  readonly fetchPage: (contract: GscQueryContract) => Promise<GscFetchPage>;
  readonly onPage?: (entry: GscPaginationLog) => void;
}

function sameRow(left: GscNormalizedRow, right: GscNormalizedRow): boolean {
  return left.dataset === right.dataset
    && left.identity === right.identity
    && left.clicks === right.clicks
    && left.impressions === right.impressions
    && left.ctr === right.ctr
    && left.position === right.position;
}

function validatePage(rows: readonly GscRawSearchRow[]): void {
  if (rows.length > GSC_ROW_LIMIT) throw new Error("GSC_PAGE_SIZE_INVALID");
}

/**
 * Stages every provider page before returning a completed partition. A failed page
 * throws without exposing the staged rows, so callers cannot publish a partial partition.
 */
export async function stageGscPartition(input: StageGscPartitionInput): Promise<CompletedGscPartition> {
  const staged = new Map<string, GscNormalizedRow>();
  let startRow = 0;
  let pagesFetched = 0;
  let rowsReceived = 0;
  let providerRowLimitReached = false;

  while (startRow < GSC_DAILY_ROW_LIMIT) {
    const pageContract = withGscStartRow(input.contract, startRow);
    const response = await input.fetchPage(pageContract);
    validatePage(response.rows);
    pagesFetched += 1;
    rowsReceived += response.rows.length;
    input.onPage?.({ startRow, returnedRows: response.rows.length });

    for (const rawRow of response.rows) {
      const row = normalizeGscRow(pageContract, rawRow);
      const existing = staged.get(row.identity);
      if (existing && !sameRow(existing, row)) throw new Error("GSC_DUPLICATE_ROW_CONFLICT");
      staged.set(row.identity, row);
    }

    if (response.rows.length < GSC_ROW_LIMIT) break;
    startRow += response.rows.length;
    if (startRow >= GSC_DAILY_ROW_LIMIT) providerRowLimitReached = true;
  }

  const sourceCoverage = input.sourceCoverage ?? "REQUEST_COMPLETE_WITH_PROVIDER_LIMITS";
  return {
    contract: input.contract,
    rows: [...staged.values()],
    quality: {
      dataState: "final",
      dataThrough: input.dataThrough,
      fetchComplete: true,
      sourceCoverage,
      pagesFetched,
      rowsReceived,
      providerRowLimitReached,
    },
  };
}

export async function replaceCompletedGscPartition(input: StageGscPartitionInput & {
  readonly replace: (partition: CompletedGscPartition) => Promise<void>;
}): Promise<CompletedGscPartition> {
  const completed = await stageGscPartition(input);
  await input.replace(completed);
  return completed;
}
