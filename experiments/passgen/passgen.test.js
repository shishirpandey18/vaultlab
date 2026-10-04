//Test for passgen.js. Run with: npm test 
const test = require("node:test");
const assert = require("node:assert/strict");
const { SETS, parseArgs, validate, generatePassword } = require("./passgen.js");
const { count } = require("node:console");

test("password has the required length", ()=>{
    const pw =generatePassword(20, [SETS.lower, SETS.digits]);
    assert.equal(pw.length,20);
});

test("password contains at least one character from every chosen set", ()=>{
    const sets = [SETS.lower, SETS.upper, SETS.digits, SETS.symbols];

    for (let i=0; i<50; i++){
        const pw = generatePassword(8, sets);
        for (const set of sets) {
            assert.ok([...pw].some((ch)=>set.includes(ch)),`missing a character from ${set}`);
        }
    }
});

test("--no-symbols leaves symbols out", ()=>{
    const options = parseArgs (["--no-symbols"]);
    assert.equal(options.symbols, false);
    const pw = generatePassword(64, [SETS.lower, SETS.upper, SETS.digits]);
    assert.ok(![...pw].some((ch)=>SETS.symbols.includes(ch)));
});

test("too short a length is rejected", ()=>{
    assert.throws(()=>validate({ length: 4, count:1 }), RangeError);
});

test("an unknown option is rejected", ()=>{
    assert.throws(()=>parseArgs(["--colour"]), /Unknown option/)
});

