import assert from "node:assert/strict";
import { test } from "node:test";

import { describeWorkerActivity } from "../ui/worker-metrics-presentation";

test("worker activity summary prioritizes actionable problems in plain Vietnamese", () => {
  assert.match(describeWorkerActivity({ queueDepth: 20, successfulJobs: 2, failedAttempts: 1, quotaFailures: 3 }), /3 lượt bị giới hạn quota/);
  assert.match(describeWorkerActivity({ queueDepth: 20, successfulJobs: 2, failedAttempts: 1, quotaFailures: 0 }), /1 lượt xử lý.*không hoàn tất/);
  assert.match(describeWorkerActivity({ queueDepth: 20, successfulJobs: 2, failedAttempts: 0, quotaFailures: 0 }), /hoàn thành 2 sản phẩm/);
  assert.match(describeWorkerActivity({ queueDepth: 20, successfulJobs: 0, failedAttempts: 0, quotaFailures: 0 }), /20 sản phẩm đang chờ/);
  assert.match(describeWorkerActivity({ queueDepth: 0, successfulJobs: 0, failedAttempts: 0, quotaFailures: 0 }), /Không có sản phẩm đang chờ/);
});
