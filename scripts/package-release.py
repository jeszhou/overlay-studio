"""Package a single Git revision into a runnable source ZIP and a static dist ZIP."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_dist(project):
    manifest = json.loads((project / "scripts/build-inputs.json").read_bytes())
    static = {p[7:]: h for p, h in manifest.items() if p.startswith("public/")}
    public = {p.relative_to(project / "public").as_posix() for p in (project / "public").rglob("*") if p.is_file()}
    if public != set(static):
        raise ValueError(f"源码包的 public 与构建清单不符: {sorted(public ^ set(static))}")
    root = project / "dist"
    files = {}
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        name = path.relative_to(root).as_posix()
        if name in static:
            if digest(path) != static[name]:
                raise ValueError(f"静态文件内容不符: {name}")
        elif name != "index.html" and not re.fullmatch(r"assets/[\w.-]+-[\w-]+\.(?:js|css)", name, re.ASCII):
            raise ValueError(f"dist 中出现了未登记的文件: {name}")
        files[name] = path
    missing = (set(static) | {"index.html"}) - files.keys()
    if missing or not any(p.endswith(".js") for p in files):
        raise ValueError(f"dist 构建不完整: {sorted(missing)}")
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default="HEAD")
    parser.add_argument("--output", required=True, type=Path, help="新目录，已有目录不会覆盖")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    commit = subprocess.check_output(["git", "rev-parse", "--verify", "--end-of-options", args.ref + "^{commit}"], cwd=repo, text=True).strip()
    destination = args.output.resolve()
    if destination.exists():
        parser.error(f"输出目录已存在: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        parser.error("请先安装 Node.js 和 npm")
    with tempfile.TemporaryDirectory(dir=destination.parent) as staging, tempfile.TemporaryDirectory() as extracted:
        artifacts = Path(staging) / "artifacts"
        artifacts.mkdir()
        source = artifacts / f"OverlayStudioFree-{commit[:7]}-source.zip"
        subprocess.run(["git", "archive", "--format=zip", "--prefix=OverlayStudioFree/", "-o", str(source), commit], cwd=repo, check=True)
        with ZipFile(source) as archive:
            archive.extractall(extracted)
        project = Path(extracted) / "OverlayStudioFree/motion-playground"
        subprocess.run([npm, "run", "build"], cwd=project, check=True)
        files = verify_dist(project)
        dist = artifacts / f"OverlayStudioFree-{commit[:7]}-dist.zip"
        with ZipFile(dist, "w") as archive:
            for name, path in sorted(files.items()):
                info = ZipInfo("dist/" + name)
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                archive.writestr(info, path.read_bytes(), compress_type=ZIP_DEFLATED)
        (artifacts / "SHA256SUMS").write_text("".join(f"{digest(p)}  {p.name}\n" for p in (source, dist)), encoding="ascii")
        artifacts.rename(destination)
    print(f"{commit} → {destination} ({len(files)} dist files)")


if __name__ == "__main__":
    main()
