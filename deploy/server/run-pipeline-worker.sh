#!/bin/sh
set -eu

exec node --import tsx scripts/shopify-pipeline-worker.ts
