const fs = require("node:fs/promises");
const path = require("node:path");

async function loadVault() {
  const file = path.join(__dirname, "vault-items.json");
  const text = await fs.readFile(file, "utf8");
  return JSON.parse(text);
}

loadVault()
  .then((items) => console.log(`Loaded ${items.length} items:`, items.map((i) => i.title)))
  .catch((err) => {
    console.error("Could not load the vault:", err.message);
    process.exitCode = 1;
  });