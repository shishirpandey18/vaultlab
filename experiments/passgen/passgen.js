#!/usr/bin/env node
//secure password generator (Day 2)
//Usage node passgen.js --length 20 --count 3 --no-symbols

const crypto = require("node:crypto");

const SETS = {
    lower: "abcdefghijklmnopqrstuvwxyz",
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    digits: "0123456789",
    symbols: "!@#$%^&*()-_=+[]{};:,.?",
};

const HELP = `
Usage: node passgen.js [options]

  -l, --length <n>   password length, 8-128 (default 16)
  -c, --count <n>    how many passwords, 1-20 (default 1)
  --no-upper         leave out A-Z
  --no-digits        leave out 0-9
  --no-symbols       leave out symbols
  -h, --help         show this help
`;

// turn ["--length", "20", "--no-symbols"] into { length: 20, symbols: false, ...}
function parseArgs(argv) {
    const options = { length: 16, count: 1, lower: true, upper: true, digits: true, symbols: true, help: false};
    for(let i = 0; i<argv.length; i++){
        const arg = argv[i];
        if (arg === "-l" || arg === "--length"){
            options.length = Number(argv[++i]); //++i: take the next word as the value
        } else if(arg === "-c" || arg === "--count"){
            options.count = Number(argv[++i]);
        } else if (arg === "--no-opper") {
            options.upper = false;
        } else if (arg === "--no-digits"){
            options.digits= false;
        } else if (arg === "--no-symbols"){
            options.symbols = false;
        } else if (arg === "-h" || arg === "--help"){
            options.help = true;
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
     }
     return options;
}

function validate(options) {
    if(!Number.isInteger(options.length)||options.length < 8 || options.length >128){
        throw new RangeError("--length must be whole number form 8 to 128");
    }
    if(!Number.isInteger(options.count)||options.count < 1 || options.count > 20){
        throw new RangeError("--count must be whole number form 1 to 20");
    }
}

//crypto.randomInt(n) returns a secure random whole number from 0 to n-1
function generatePassword(length, sets) {
    //1. one character from each chosen set, so every type appears at least once 
    const chars = sets.map((set)=>set[crypto.randomInt(set.length)]);
    // 2. Fill the rest from all chossen characters together 
    const pool = sets.join("");
    while (chars.length < length){
        chars.push(pool[crypto.randomInt(pool.length)]);
    }
    // 3. shuffle (Fisher-Yates) so the guaranteed characters are not always at the start
    for (let i = chars.length - 1; i > 0; i--){
        const j = crypto.randomInt(i+1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
}
// Entropy: how many yes/no guesses an attacker needs, in bits
function entropyBits(length, poolSize) {
  return Math.round(length * Math.log2(poolSize));
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(HELP);
      return;
    }
    validate(options);

    const sets = Object.keys(SETS)
      .filter((name) => options[name])
      .map((name) => SETS[name]);
    const poolSize = sets.join("").length;

    for (let n = 0; n < options.count; n++) {
      console.log(generatePassword(options.length, sets));
    }
    console.error(`(${poolSize} possible characters, about ${entropyBits(options.length, poolSize)} bits of entropy)`);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    console.error("Run with --help to see the options.");
    process.exitCode = 1; // tells the shell this run failed
  }
}

// Run main() only when started with `node passgen.js`, not when a test file requires it
if (require.main === module) {
  main();
}

module.exports = { SETS, parseArgs, validate, generatePassword, entropyBits };