console.log("A: Start");
setTimeout(()=>console.log("B: timeout 0 ms"), 0);
Promise.resolve().then(()=> console.log("C: promise"));
console.log("D: end");
