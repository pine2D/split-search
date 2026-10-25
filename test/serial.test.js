import { test } from "node:test";
import assert from "node:assert/strict";
import { serialQueue } from "../src/lib/serial.js";

const delay = (ms, fn) => new Promise((res, rej) => setTimeout(() => { try { res(fn()); } catch (e) { rej(e); } }, ms));

test("serialQueue：按顺序执行，前一个失败不影响后一个", async () => {
  const q = serialQueue();
  const order = [];
  const running = [];
  const job = (n, ms, fail) => () => {
    running.push(n);
    assert.equal(running.length, 1, `第 ${n} 个开始时还有别的在跑`);
    return delay(ms, () => {
      order.push(n);
      running.pop();
      if (fail) throw new Error(`boom ${n}`);
      return n * 10;
    });
  };
  // 第 1 个最慢且失败；后两个更快，串行时仍排在它后面
  const p1 = q(job(1, 30, true));
  const p2 = q(job(2, 5));
  const p3 = q(job(3, 1));
  await assert.rejects(p1, /boom 1/);
  assert.equal(await p2, 20);
  assert.equal(await p3, 30);
  assert.deepEqual(order, [1, 2, 3]);
});

test("serialQueue：同步抛错也只交给自己的调用方", async () => {
  const q = serialQueue();
  const p1 = q(() => { throw new Error("sync"); });
  const p2 = q(async () => "ok");
  await assert.rejects(p1, /sync/);
  assert.equal(await p2, "ok");
});

test("serialQueue：各条队列互不阻塞", async () => {
  const a = serialQueue(), b = serialQueue();
  let release;
  const pa = a(() => new Promise(r => { release = r; }));
  assert.equal(await b(async () => "b"), "b");
  release("a");
  assert.equal(await pa, "a");
});
