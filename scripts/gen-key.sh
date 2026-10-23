#!/usr/bin/env bash
# 生成（或复用）扩展私钥，把公钥写入 src/manifest.json 的 key，并打印扩展 ID。可重复执行。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_DIR="$HOME/.config/split-search"
KEY_FILE="$KEY_DIR/extension-key.pem"
MANIFEST="$ROOT/src/manifest.json"

if [ ! -f "$KEY_FILE" ]; then
  mkdir -p "$KEY_DIR"
  chmod 700 "$KEY_DIR"
  openssl genrsa 2048 2>/dev/null > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  echo "已生成私钥：$KEY_FILE（请备份，丢失后扩展 ID 会变）"
fi

PUB_B64="$(openssl rsa -in "$KEY_FILE" -pubout -outform DER 2>/dev/null | base64 -w0)"

PUB_B64="$PUB_B64" MANIFEST="$MANIFEST" node -e '
const fs = require("fs");
const crypto = require("crypto");
const p = process.env.MANIFEST;
const b64 = process.env.PUB_B64;
const m = JSON.parse(fs.readFileSync(p, "utf8"));
m.key = b64;
fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
const hex = crypto.createHash("sha256").update(Buffer.from(b64, "base64")).digest("hex").slice(0, 32);
const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
console.log("扩展 ID：" + id);
'
