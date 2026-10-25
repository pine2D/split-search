// 纯逻辑：串行队列。按调用顺序逐个执行，前一个失败不影响后一个；返回值和错误交给各自的调用方。
export function serialQueue() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(() => fn());
    tail = run.then(() => {}, () => {});
    return run;
  };
}
