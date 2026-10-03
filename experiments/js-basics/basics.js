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

console.log("--- 4. functions and arrow functions ---");
function isStrong(password) {
    return password.length >= 12;
}
const isWeak = (password) => !isStrong(password);
console.log(isStrong("shishir-pandey-Nepal"), isWeak("1234"));

console.log("--- 5. closures ---");
//makeCounter returns a function that still remembers `count`
function makeCounter(){
    let count =0;
    return () => ++count;
}
const failedLogins = makeCounter();
const logins = makeCounter();
failedLogins();
failedLogins();
logins();
logins();
logins();
console.log("failedLogins:", failedLogins());
console.log("logins:", logins());

console.log("--- 6. arrays: map, filter, reduce --- ");
const vault = [
    {title: "GitHub", username: "shishir", password: "shishir-pandey-Nepal", tags: ["work"]},
    {title: "Bank", username: "s.pandey", password: "1234", tags: ["money"]},
    {title: "Email", username: "shishir", password: "sjT9Us%Qk#o", tags:[]}
];
const titles= vault.map((item)=> item.title);
const weak= vault.filter((item)=>isWeak(item.password)).map((item)=>item.title);
const totalLength=  vault.reduce((sum, item) => sum+item.password.length, 0);
console.log(titles, weak, totalLength);
