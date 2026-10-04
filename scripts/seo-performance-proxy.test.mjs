import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

test("Nginx forwards SEO Performance and OAuth headers without logging callback codes", {
  skip: process.env.FFP_NGINX_TEST_IMAGE ? false : "Set FFP_NGINX_TEST_IMAGE to an existing Nginx image for isolated runtime testing",
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ffp-proxy-test-"));
  let container;
  function docker(args) {
    const result = spawnSync("docker", args, { encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout;
  }
  try {
    const source = (await readFile("deploy/client/nginx.conf", "utf8"))
      .replaceAll("server:3001", "127.0.0.1:3001")
      .replaceAll("server:8766", "127.0.0.1:8766")
      .replaceAll("server:8768", "127.0.0.1:8768");
    const configuration = `events {}\nhttp { access_log /dev/stdout; ${source}
      server { listen 3001; access_log off;
        location / { default_type application/json; return 200 '{"upstream":"gateway","auth":"$http_authorization","cookie":"$http_cookie","csrf":"$http_x_ffp_performance","uri":"$request_uri"}'; }
      }
    }`;
    await writeFile(path.join(directory, "nginx.conf"), configuration);
    container = docker(["run", "-d", "--rm", "--network", "none", "--mount", `type=bind,source=${directory},target=/test,readonly`,
      "--entrypoint", "nginx", process.env.FFP_NGINX_TEST_IMAGE, "-c", "/test/nginx.conf", "-g", "daemon off;"]).trim();
    docker(["exec", container, "nginx", "-t", "-c", "/test/nginx.conf"]);
    for (const route of ["overview?storeId=fixture", "oauth/callback?code=fixture-sensitive-code&state=fixture-state"]) {
      const response = docker(["exec", container, "wget", "-qO-", "--header=Authorization: Basic fixture", "--header=Cookie: ffp_gsc_oauth=fixture", `http://127.0.0.1/api/seo-performance/${route}`]);
      const body = JSON.parse(response);
      assert.equal(body.upstream, "gateway");
      assert.equal(body.auth, "Basic fixture");
      assert.equal(body.cookie, "ffp_gsc_oauth=fixture");
      assert.equal(body.uri, `/api/seo-performance/${route}`);
    }
    const report = JSON.parse(docker(["exec", container, "wget", "-qO-", "--post-data={}", "--header=X-FFP-Performance: 1", "http://127.0.0.1/api/seo-performance/report"]));
    assert.equal(report.csrf, "1");
    assert.doesNotMatch(docker(["logs", container]), /fixture-sensitive-code/);
  } finally {
    if (container) docker(["stop", "-t", "1", container]);
    await rm(directory, { recursive: true, force: true });
  }
});
