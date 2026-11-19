import { spawn } from "node:child_process";

/** Kill only this job's process tree, including Chromium's detached descendants. */
export async function stopProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  if (process.platform === "win32") {
    await new Promise((resolve, reject) => {
      const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0 || code === 128) resolve(); // 128: process already ended.
        else reject(new Error(`taskkill exited with ${code}`));
      });
    });
    return;
  }
  // A process-group signal alone misses Chrome, which creates its own group.
  const rows = await new Promise((resolve, reject) => {
    const child = spawn("ps", ["-A", "-o", "pid=,ppid="], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Cannot inspect export process tree (ps exit ${code})`));
      else resolve(out.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number)));
    });
  });
  const children = new Map();
  for (const [child, parent] of rows) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  }
  const descendants = [];
  const visit = (parent) => {
    for (const child of children.get(parent) ?? []) { visit(child); descendants.push(child); }
  };
  visit(pid);
  const failures = [];
  for (const target of [...descendants, pid]) {
    try { process.kill(target, "SIGKILL"); }
    catch (error) { if (error.code !== "ESRCH") failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "Cannot stop export process tree");
}
