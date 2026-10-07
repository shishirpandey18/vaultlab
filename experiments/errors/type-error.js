const vault = [
  { title: "GitHub", login: { username: "shishir" } },
  { title: "Bank" },
];

function showUsername(item) {
  return item.login.username;
}

for (const item of vault) {
  console.log(item.title, "->", showUsername(item));
}