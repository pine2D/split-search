#!/usr/bin/env bash
# 打印扩展 ID；manifest 还没有 key 时，生成一把一次性密钥，只把公钥写入 src/manifest.json 的 key。
# 扩展 ID 只由 manifest 里的公钥决定，私钥只在自签 .crx 时才用得上，本项目用不到，所以不保留。
# manifest 已有 key 时绝不改动它（改了扩展 ID 就会变），可重复执行。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/src/manifest.json"

if ! MANIFEST="$MANIFEST" node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.env.MANIFEST, "utf8")).key ? 0 : 1)'; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  openssl genrsa -out "$TMP/key.pem" 2048
  PUB_B64="$(openssl rsa -in "$TMP/key.pem" -pubout -outform DER | base64 -w0)"
  PUB_B64="$PUB_B64" MANIFEST="$MANIFEST" node -e '
const fs = require("fs");
const p = process.env.MANIFEST;
const m = JSON.parse(fs.readFileSync(p, "utf8"));
m.key = process.env.PUB_B64;
fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
'
  echo "已把新公钥写入 manifest 的 key（私钥未保留）"
fi

MANIFEST="$MANIFEST" node -e '
const fs = require("fs");
const crypto = require("crypto");
const b64 = JSON.parse(fs.readFileSync(process.env.MANIFEST, "utf8")).key;
const hex = crypto.createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex").slice(0, 32);
console.log("扩展 ID：" + [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""));
'
