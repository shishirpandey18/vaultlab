const { generatePassword, SETS } = require("./passgen");
console.log(generatePassword(12, [SETS.lower, SETS.digits]));