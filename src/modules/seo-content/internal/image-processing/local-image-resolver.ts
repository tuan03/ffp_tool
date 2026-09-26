import * as fs from "node:fs";
import * as path from "node:path";

const SEARCH_SUBDIRS: readonly string[] = [
  "",
  "lifestyle_mockups",
  "final_print",
  "product_cutouts",
  "product_cutouts_white",
  "artwork_designs",
  "room_templates",
  "task5_crawl/downloaded_images",
  "dedupe/kept",
  "task5_crawl",
];

function getCandidateRoots(cwd: string = process.cwd()): readonly string[] {
  return [
    path.resolve(cwd, "src/modules/pinterest-pod/server/data/pinterest_pod/output"),
    path.resolve(cwd, "src/modules/pinterest-pod/server/temp/pinterest_pod"),
    path.resolve(cwd, "src/modules/pinterest-pod/server/output"),
    path.resolve(cwd, "src/modules/pinterest-pod/server/temp"),
    path.resolve(cwd, "temp/pinterest_pod"),
    path.resolve(cwd, "data/pinterest_pod/output"),
  ];
}

function findInRunDir(runDir: string, filename: string): string | undefined {
  if (!fs.existsSync(runDir)) return undefined;

  const candidateNames = [filename];
  if (filename.includes("_white.") || filename.includes("-white.")) {
    candidateNames.push(filename.replace(/(_white|-white)(\.[a-zA-Z0-9]+)$/i, "$2"));
  }

  for (const name of candidateNames) {
    for (const sub of SEARCH_SUBDIRS) {
      const candidatePath = sub ? path.join(runDir, sub, name) : path.join(runDir, name);
      if (fs.existsSync(candidatePath)) {
        try {
          if (fs.statSync(candidatePath).isFile()) return candidatePath;
        } catch {
          // Continue searching
        }
      }
    }
  }

  return undefined;
}

function findFileRecursively(dir: string, targetName: string, maxDepth = 3): string | undefined {
  if (maxDepth < 0 || !fs.existsSync(dir)) return undefined;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === targetName) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        const sub = findFileRecursively(fullPath, targetName, maxDepth - 1);
        if (sub) return sub;
      }
    }
  } catch {
    // Ignore unreadable directories
  }
  return undefined;
}

/**
 * Robustly resolves a local image file path on disk across repository root,
 * server temp, and output directories with exact run ID precedence to prevent collisions.
 */
export function resolveLocalImageFile(rawPath?: string, url?: string, customCwd?: string): string | undefined {
  if (!rawPath && !url) return undefined;
  const cwd = customCwd ? path.resolve(customCwd) : process.cwd();

  // 1. Direct path check if rawPath points to an existing file
  if (rawPath && rawPath.trim()) {
    const trimmed = rawPath.trim();
    const candidateDirect = [
      path.resolve(trimmed),
      path.resolve(cwd, trimmed),
      path.resolve(cwd, "src/modules/pinterest-pod/server", trimmed),
      path.resolve(cwd, "src/modules/pinterest-pod/server/temp", trimmed),
    ];
    for (const cand of candidateDirect) {
      if (fs.existsSync(cand)) {
        try {
          if (fs.statSync(cand).isFile()) return cand;
        } catch {
          // Continue
        }
      }
    }
  }

  // 2. Extract runId and target filename from rawPath and/or url
  let detectedRunId: string | undefined;
  let targetFilename: string | undefined;

  if (url && url.trim()) {
    try {
      const cleanUrl = url.trim().split(/[?#]/)[0] ?? "";
      const assetMatch = cleanUrl.match(/\/api\/pinterest-pod\/assets\/([a-zA-Z0-9_-]+)\/([^/?#]+)/);
      if (assetMatch?.[1] && assetMatch?.[2]) {
        detectedRunId = assetMatch[1];
        targetFilename = path.basename(decodeURIComponent(assetMatch[2]));
      } else {
        targetFilename = path.basename(cleanUrl);
      }
    } catch {
      // Continue
    }
  }

  if (rawPath && rawPath.trim()) {
    const normalized = rawPath.trim().replace(/\\/g, "/");
    const runMatch = normalized.match(/(run_\d+_\d+|job_[a-zA-Z0-9_-]+)\/([^/]+)$/);
    if (runMatch?.[1] && runMatch?.[2]) {
      detectedRunId = runMatch[1];
      targetFilename = path.basename(runMatch[2]);
    } else if (!targetFilename) {
      targetFilename = path.basename(normalized);
    }
  }

  if (!targetFilename || targetFilename.length < 3) return undefined;

  const candidateRoots = getCandidateRoots(cwd);

  // 3. Priority check: If runId is known, look ONLY inside candidate roots with that runId
  if (detectedRunId) {
    for (const root of candidateRoots) {
      const runDir = path.join(root, detectedRunId);
      const found = findInRunDir(runDir, targetFilename);
      if (found) return found;
    }
  }

  // 4. Secondary check: Scan recent run directories sorted by modification time descending
  for (const root of candidateRoots) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      const runDirsWithTime: Array<{ path: string; mtimeMs: number }> = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(root, entry.name);
        try {
          const stats = fs.statSync(dirPath);
          runDirsWithTime.push({ path: dirPath, mtimeMs: stats.mtimeMs });
        } catch {
          // Ignore
        }
      }

      runDirsWithTime.sort((a, b) => b.mtimeMs - a.mtimeMs);

      for (const dirObj of runDirsWithTime.slice(0, 15)) {
        const found = findInRunDir(dirObj.path, targetFilename);
        if (found) return found;
      }
    } catch {
      // Continue
    }
  }

  // 5. Final fallback: Deep recursive search in candidate roots
  for (const root of candidateRoots) {
    const found = findFileRecursively(root, targetFilename, 3);
    if (found) return found;
  }

  return undefined;
}
