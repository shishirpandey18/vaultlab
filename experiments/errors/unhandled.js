const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchItem(id) {
  await wait(300);
  if (id < 0) throw new Error(`Item ${id} not found`);
  return { id };
}

fetchItem(-1);
setTimeout(() => console.log("This line never runs"), 1000);