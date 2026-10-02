console.log("--- 1. let, const, typeof ---");
const site = "GITHUB"; 
let attempts = 0;
attempts = attempts +1;
console.log (typeof site, typeof attempts, typeof true, typeof undefined, typeof null, typeof {}, typeof [] );

console.log("--- 2. == vs === ---");
console.log(0 == "0", 0 === "0");
console.log(null == undefined, null === undefined);
console.log("5" + 1, "5" - 1)

console.log("--- 3. truthy and falsy ---");
const samples = [[0, "0"], ["", '""'], [null, "null"], [undefined, "undefined"], [NaN, "NaN"], ["0", "0"],[[], "[]"], [{}, "{}"]];
for (const [value,label] of samples) {
    console.log(label, "->", value ? "truthy" : "falsy");
}