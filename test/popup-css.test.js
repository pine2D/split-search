import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 弹窗的颜色变量是从设置页复制的（popup.css 开头的注释），两处要一起改：这里守住“子集且取值相同”
const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

// 返回 { light, dark }：顶层 :root 与 @media (prefers-color-scheme: dark) 里 :root 的 --变量
function tokens(css) {
  const body = (re) => {
    const m = css.match(re);
    assert.ok(m, `没找到 ${re}`);
    return Object.fromEntries([...m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
  };
  return {
    light: body(/^:root\s*\{([^}]*)\}/m),
    dark: body(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/),
  };
}

test("popup.css 的颜色变量是 options.css 的子集，浅色、深色取值都相同", () => {
  const pop = tokens(read("popup/popup.css"));
  const opt = tokens(read("options/options.css"));
  for (const mode of ["light", "dark"]) {
    assert.ok(Object.keys(pop[mode]).length > 0, `${mode} 没有变量`);
    for (const [k, v] of Object.entries(pop[mode])) {
      assert.equal(opt[mode][k], v, `${mode} ${k}：popup ${v}，options ${opt[mode][k]}`);
    }
  }
  assert.deepEqual(Object.keys(pop.dark).sort(), Object.keys(pop.light).sort(), "弹窗浅色、深色定义的变量相同");
});
