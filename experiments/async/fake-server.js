const wait = (ms) => new Promise((resolve)=>setTimeout(resolve,ms));
async function fetchItem(id) {
    await wait(500);
    if (id <0 ) throw new Error(`Item ${id} not found`);
    return {id, title: `Item${id}`};
}
async function main(){
    console.time("one by one");
    const a= await fetchItem(1);
    const b= await fetchItem(2);
    const c= await fetchItem(3);
    console.timeEnd("one by one");
    console.log(a.title, b.title, c.title);

    console.time("all at once");
    const items = await Promise.all([fetchItem(1), fetchItem(2), fetchItem(3)]);
    console.timeEnd("all at once");
    console.log(items.map((item)=>item.title))

    try {
    await fetchItem(-1);
  } catch (err) {
    console.log("Caught:", err.message);
  }
}

main();

